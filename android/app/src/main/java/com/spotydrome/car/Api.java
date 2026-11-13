package com.spotydrome.car;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class Api {

    static final class AuthException extends IOException {
        AuthException(String message) {
            super(message);
        }
    }

    static final class DeviceLink {
        final String deviceCode;
        final String userCode;
        final long expiresAt;
        final int intervalSeconds;

        DeviceLink(String deviceCode, String userCode, long expiresAt, int intervalSeconds) {
            this.deviceCode = deviceCode;
            this.userCode = userCode;
            this.expiresAt = expiresAt;
            this.intervalSeconds = intervalSeconds;
        }
    }

    private final Context context;
    private final Prefs prefs;

    Api(Context context) {
        this.context = context.getApplicationContext();
        prefs = new Prefs(context);
    }

    DeviceLink startDeviceLink(String deviceName) throws IOException {
        try {
            JSONObject json = Http.postJson(context, Prefs.SERVER + "/api/devices/start", new JSONObject().put("name", deviceName));
            return new DeviceLink(json.getString("deviceCode"), json.getString("userCode"), json.getLong("expiresAt"), Math.max(2, json.optInt("interval", 3)));
        } catch (JSONException e) {
            throw new IOException("The server sent an unexpected answer", e);
        }
    }

    // Returns true once a user approved the code and the session is saved; false while still waiting.
    boolean pollDeviceLink(String deviceCode) throws IOException {
        try {
            JSONObject json = Http.postJson(context, Prefs.SERVER + "/api/devices/poll", new JSONObject().put("deviceCode", deviceCode));
            if (json.optInt("_status") == 202) {
                return false;
            }
            String username = json.getString("username");
            prefs.saveSession(username, json.optString("name", username), json.getString("subsonicToken"), json.getString("subsonicSalt"));
            return true;
        } catch (JSONException e) {
            throw new IOException("The server sent an unexpected answer", e);
        }
    }

    private Uri.Builder rest(String method) {
        return Uri.parse(Prefs.SERVER + "/rest/" + method).buildUpon()
                .appendQueryParameter("u", prefs.username())
                .appendQueryParameter("t", prefs.token())
                .appendQueryParameter("s", prefs.salt())
                .appendQueryParameter("v", "1.16.1")
                .appendQueryParameter("c", "odeon-car")
                .appendQueryParameter("f", "json");
    }

    private JSONObject call(Uri.Builder uri) throws IOException {
        JSONObject json;
        try {
            json = Http.getJson(context, uri.build().toString());
        } catch (Http.HttpException e) {
            if (e.status == 403) {
                throw new IOException("This network is blocked by the server for a while after too many failed attempts.");
            }
            json = subsonicBody(e.body);
            if (json == null) {
                throw e;
            }
        }
        JSONObject response = json.optJSONObject("subsonic-response");
        if (response == null) {
            throw new IOException("The server sent an unexpected answer");
        }
        if (!"ok".equals(response.optString("status"))) {
            JSONObject error = response.optJSONObject("error");
            int code = error == null ? 0 : error.optInt("code");
            String message = error == null ? "The music server reported an error" : error.optString("message", "The music server reported an error");
            if (code == 40 || code == 41 || code == 44) {
                throw new AuthException("This tablet is no longer signed in. Link it again from Odeon on your phone.");
            }
            throw new IOException(message);
        }
        return response;
    }

    private static JSONObject subsonicBody(String body) {
        try {
            return new JSONObject(body);
        } catch (JSONException e) {
            return null;
        }
    }

    void ping() throws IOException {
        call(rest("ping"));
    }

    List<Media.Collection> albumList(String type, int size, int offset) throws IOException {
        JSONObject list = call(rest("getAlbumList2").appendQueryParameter("type", type).appendQueryParameter("size", String.valueOf(size)).appendQueryParameter("offset", String.valueOf(offset))).optJSONObject("albumList2");
        return Media.collections(list == null ? null : list.optJSONArray("album"), Media.Collection::album);
    }

    List<Media.Collection> playlists() throws IOException {
        JSONObject list = call(rest("getPlaylists")).optJSONObject("playlists");
        return Media.collections(list == null ? null : list.optJSONArray("playlist"), Media.Collection::playlist);
    }

    List<Media.Collection> artists() throws IOException {
        JSONObject artists = call(rest("getArtists")).optJSONObject("artists");
        List<Media.Collection> all = new ArrayList<>();
        JSONArray indexes = artists == null ? null : artists.optJSONArray("index");
        if (indexes != null) {
            for (int i = 0; i < indexes.length(); i++) {
                JSONObject index = indexes.optJSONObject(i);
                all.addAll(Media.collections(index == null ? null : index.optJSONArray("artist"), Media.Collection::artist));
            }
        }
        return all;
    }

    Media.Page page(Media.Collection collection) throws IOException {
        switch (collection.kind) {
            case Media.Collection.ALBUM: {
                JSONObject album = call(rest("getAlbum").appendQueryParameter("id", collection.id)).optJSONObject("album");
                return new Media.Page(album == null ? collection : Media.Collection.album(album), Media.songs(album == null ? null : album.optJSONArray("song")), new ArrayList<>());
            }
            case Media.Collection.PLAYLIST: {
                JSONObject playlist = call(rest("getPlaylist").appendQueryParameter("id", collection.id)).optJSONObject("playlist");
                return new Media.Page(playlist == null ? collection : Media.Collection.playlist(playlist), Media.songs(playlist == null ? null : playlist.optJSONArray("entry")), new ArrayList<>());
            }
            case Media.Collection.ARTIST: {
                JSONObject artist = call(rest("getArtist").appendQueryParameter("id", collection.id)).optJSONObject("artist");
                List<Media.Collection> albums = Media.collections(artist == null ? null : artist.optJSONArray("album"), Media.Collection::album);
                return new Media.Page(artist == null ? collection : Media.Collection.artist(artist), new ArrayList<>(), albums);
            }
            default: {
                JSONObject starred = call(rest("getStarred2")).optJSONObject("starred2");
                return new Media.Page(collection, Media.songs(starred == null ? null : starred.optJSONArray("song")), new ArrayList<>());
            }
        }
    }

    Media.SearchResult search(String query) throws IOException {
        JSONObject result = call(rest("search3").appendQueryParameter("query", query).appendQueryParameter("songCount", "40").appendQueryParameter("albumCount", "20").appendQueryParameter("artistCount", "10")).optJSONObject("searchResult3");
        if (result == null) {
            return new Media.SearchResult(new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        }
        return new Media.SearchResult(Media.songs(result.optJSONArray("song")), Media.collections(result.optJSONArray("album"), Media.Collection::album), Media.collections(result.optJSONArray("artist"), Media.Collection::artist));
    }

    // Transcoded to MP3 when needed: every Android 4.2 decoder handles it. Navidrome only honors timeOffset when it
    // transcodes, so callers pass 0 for files it sends as-is (see Media.Song.streamsAsIs).
    String streamUrl(String songId, int bitrate, int offsetSeconds) {
        Uri.Builder uri = rest("stream").appendQueryParameter("id", songId).appendQueryParameter("format", "mp3").appendQueryParameter("maxBitRate", String.valueOf(bitrate));
        if (offsetSeconds > 0) {
            uri.appendQueryParameter("timeOffset", String.valueOf(offsetSeconds));
        }
        return uri.build().toString();
    }

    String coverUrl(String coverArt, int size) {
        return rest("getCoverArt").appendQueryParameter("id", coverArt).appendQueryParameter("size", String.valueOf(size)).build().toString();
    }

    // ---- Downtify: songs that aren't in the library yet.

    private Map<String, String> authHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Subsonic-User", prefs.username());
        headers.put("X-Subsonic-Token", prefs.token());
        headers.put("X-Subsonic-Salt", prefs.salt());
        return headers;
    }

    private JSONObject account(String method, String path, JSONObject body, int readTimeoutMs) throws IOException {
        try {
            return Http.request(context, Prefs.SERVER + path, method, body, authHeaders(), readTimeoutMs);
        } catch (Http.HttpException e) {
            if (e.status == 401) {
                throw new AuthException("This tablet is no longer signed in. Link it again from Odeon on your phone.");
            }
            throw e;
        }
    }

    List<Media.Song> catalogSearch(String query) throws IOException {
        JSONObject result = account("GET", "/api/downtify/search?q=" + Uri.encode(query), null, 30_000);
        JSONArray tracks = result.optJSONArray("tracks");
        List<Media.Song> songs = new ArrayList<>();
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject track = tracks.optJSONObject(i);
            if (track != null) {
                songs.add(Media.Song.fromCatalog(track));
            }
        }
        return songs;
    }

    // Navidrome's Instant Mix; empty unless the server has its Last.fm or Deezer agent.
    List<Media.Song> librarySimilar(Media.Song seed, int count) throws IOException {
        JSONObject similar = call(rest("getSimilarSongs2").appendQueryParameter("id", seed.id).appendQueryParameter("count", String.valueOf(count))).optJSONObject("similarSongs2");
        return Media.songs(similar == null ? null : similar.optJSONArray("song"));
    }

    // YouTube Music's radio for the song, through Downtify.
    List<Media.Song> catalogSimilar(Media.Song seed, int count) throws IOException {
        Uri.Builder uri = Uri.parse("/api/downtify/similar").buildUpon().appendQueryParameter("title", seed.title).appendQueryParameter("limit", String.valueOf(count));
        String firstArtist = seed.artist.split(", ")[0];
        if (!firstArtist.isEmpty()) {
            uri.appendQueryParameter("artist", firstArtist);
        }
        JSONArray tracks = account("GET", uri.build().toString(), null, 30_000).optJSONArray("tracks");
        List<Media.Song> songs = new ArrayList<>();
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject track = tracks.optJSONObject(i);
            if (track != null) {
                songs.add(Media.Song.fromCatalog(track));
            }
        }
        return songs;
    }

    // Asks the server which candidates fit the seed (language, year, genre) and in which order; unchecked ones are kept.
    List<Media.Song> fitToSeed(Media.Song seed, List<Media.Song> candidates) throws IOException {
        try {
            JSONArray refs = new JSONArray();
            for (int i = 0; i < candidates.size(); i++) {
                refs.put(songRef(candidates.get(i), String.valueOf(i)));
            }
            JSONObject body = new JSONObject().put("seeds", new JSONArray().put(songRef(seed, "seed0"))).put("candidates", refs).put("budgetMs", 4000);
            JSONArray keep = account("POST", "/api/recommendations/fit", body, 20_000).optJSONArray("keep");
            if (keep == null) {
                return candidates;
            }
            List<Media.Song> fitting = new ArrayList<>();
            for (int i = 0; i < keep.length(); i++) {
                int index = Integer.parseInt(keep.optString(i, "-1"));
                if (index >= 0 && index < candidates.size()) {
                    fitting.add(candidates.get(index));
                }
            }
            return fitting;
        } catch (JSONException | NumberFormatException e) {
            throw new IOException(e);
        }
    }

    private static JSONObject songRef(Media.Song song, String id) throws JSONException {
        JSONObject ref = new JSONObject().put("id", id).put("title", song.title);
        if (!song.artist.isEmpty()) {
            ref.put("artist", song.artist);
        }
        if (!song.isExternal()) {
            ref.put("library", song.id);
        }
        return ref;
    }

    void addToLibrary(Media.Song song) throws IOException {
        try {
            account("POST", "/api/downtify/downloads", new JSONObject().put("songIds", new JSONArray().put(song.catalogId)), 30_000);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    // Streamed by Downtify straight from YouTube, as AAC in MP4; MediaPlayer seeks in it with range requests.
    String catalogStreamUrl(Media.Song song) {
        return catalogUrl("stream", song);
    }

    // Has Downtify download the song into its stream cache now, so playing it later doesn't wait for the download.
    void prefetchCatalogSong(Media.Song song) throws IOException {
        Http.request(context, catalogUrl("prefetch", song), "POST", null, null, 30_000);
    }

    private String catalogUrl(String endpoint, Media.Song song) {
        Uri.Builder uri = Uri.parse(Prefs.SERVER + "/api/downtify/" + endpoint).buildUpon().appendQueryParameter("u", prefs.username()).appendQueryParameter("t", prefs.token()).appendQueryParameter("s", prefs.salt());
        if (!song.video.isEmpty()) {
            uri.appendQueryParameter("video", song.video);
        } else {
            uri.appendQueryParameter("title", song.title);
            String firstArtist = song.artist.split(", ")[0];
            if (!firstArtist.isEmpty()) {
                uri.appendQueryParameter("artist", firstArtist);
            }
            if (song.explicit) {
                uri.appendQueryParameter("explicit", "1");
            }
        }
        if (song.durationSeconds > 0) {
            uri.appendQueryParameter("duration", String.valueOf(song.durationSeconds));
        }
        return uri.build().toString();
    }

    // ---- Remote control from the user's other devices.

    void putRemoteState(String deviceId, JSONObject body) throws IOException {
        account("PUT", "/api/remote/devices/" + deviceId, body, 15_000);
    }

    JSONArray pollRemoteCommands(String deviceId) throws IOException {
        JSONArray commands = account("GET", "/api/remote/devices/" + deviceId + "/commands", null, 45_000).optJSONArray("commands");
        return commands == null ? new JSONArray() : commands;
    }
}
