package com.spotydrome.car;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class Media {

    private Media() {
    }

    static final class Song {
        final String id;
        final String title;
        final String artist;
        final String album;
        final String albumId;
        final String coverArt;
        final int durationSeconds;
        // The library file's format and kbps, as Navidrome reports them; empty and 0 for Downtify songs.
        final String suffix;
        final int bitRate;
        // Songs found through Downtify that aren't in the library yet: streamed from YouTube, never downloaded here.
        final String catalogId;
        final String coverUrl;
        final String video;
        final boolean explicit;

        Song(String id, String title, String artist, String album, String albumId, String coverArt, int durationSeconds, String suffix, int bitRate) {
            this(id, title, artist, album, albumId, coverArt, durationSeconds, suffix, bitRate, "", "", "", false);
        }

        Song(String id, String title, String artist, String album, String albumId, String coverArt, int durationSeconds, String suffix, int bitRate, String catalogId, String coverUrl, String video, boolean explicit) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.albumId = albumId;
            this.coverArt = coverArt;
            this.durationSeconds = durationSeconds;
            this.suffix = suffix;
            this.bitRate = bitRate;
            this.catalogId = catalogId;
            this.coverUrl = coverUrl;
            this.video = video;
            this.explicit = explicit;
        }

        boolean isExternal() {
            return !catalogId.isEmpty();
        }

        // The same song from the library and from YouTube Music share a key.
        String key() {
            return (title + "\n" + artist.split(", ")[0]).toLowerCase(Locale.ROOT);
        }

        // Navidrome sends a file as-is when it is already MP3 at or under the requested bitrate, and then ignores
        // timeOffset; such a stream has to be seeked with range requests like a local file.
        boolean streamsAsIs(int maxBitRate) {
            return "mp3".equalsIgnoreCase(suffix) && bitRate > 0 && bitRate <= maxBitRate;
        }

        static Song from(JSONObject json) {
            JSONObject external = json.optJSONObject("external");
            if (external != null && !external.optString("catalogId").isEmpty()) {
                String title = json.optString("title", external.optString("title", "Unknown"));
                return new Song(json.optString("id"), title, json.optString("artist", external.optString("artist", "")), json.optString("album", ""), "", "", json.optInt("duration", 0), "", 0, external.optString("catalogId"), external.optString("coverUrl", ""), external.optString("video", ""), external.optBoolean("explicit"));
            }
            return new Song(json.optString("id"), json.optString("title", "Unknown"), json.optString("artist", ""), json.optString("album", ""), json.optString("albumId", ""), json.optString("coverArt", ""), json.optInt("duration", 0), json.optString("suffix", ""), json.optInt("bitRate", 0));
        }

        // A Downtify search result, the same shape the server returns to the web app.
        static Song fromCatalog(JSONObject track) {
            JSONArray artists = track.optJSONArray("artists");
            StringBuilder names = new StringBuilder();
            for (int i = 0; artists != null && i < artists.length(); i++) {
                if (i > 0) {
                    names.append(", ");
                }
                names.append(artists.optString(i));
            }
            String catalogId = track.optString("id");
            return new Song("external:" + catalogId, track.optString("title", "Unknown"), names.toString(), track.optString("album", ""), "", "", track.optInt("duration", 0), "", 0, catalogId, track.optString("coverUrl", ""), track.optString("youtubeId", ""), track.optBoolean("explicit"));
        }

        JSONObject toJson() {
            JSONObject json = new JSONObject();
            try {
                json.put("id", id).put("title", title).put("artist", artist).put("album", album).put("albumId", albumId).put("coverArt", coverArt).put("duration", durationSeconds);
                if (!suffix.isEmpty()) {
                    json.put("suffix", suffix).put("bitRate", bitRate);
                }
                if (isExternal()) {
                    json.put("external", new JSONObject().put("catalogId", catalogId).put("coverUrl", coverUrl).put("video", video).put("title", title).put("artist", artist).put("explicit", explicit));
                }
            } catch (JSONException ignored) {
                // put() only throws for non-finite numbers.
            }
            return json;
        }
    }

    // Albums, playlists, artists and the liked-songs list all render as the same kind of tile and page.
    static final class Collection {
        static final String ALBUM = "album";
        static final String PLAYLIST = "playlist";
        static final String ARTIST = "artist";
        static final String LIKED = "liked";

        final String kind;
        final String id;
        final String name;
        final String subtitle;
        final String coverArt;

        Collection(String kind, String id, String name, String subtitle, String coverArt) {
            this.kind = kind;
            this.id = id;
            this.name = name;
            this.subtitle = subtitle;
            this.coverArt = coverArt;
        }

        String key() {
            return kind + ":" + id;
        }

        static Collection album(JSONObject json) {
            String artist = json.optString("artist", "");
            int year = json.optInt("year", 0);
            return new Collection(ALBUM, json.optString("id"), json.optString("name", json.optString("title", "Unknown")), year > 0 ? artist + " • " + year : artist, json.optString("coverArt", ""));
        }

        static Collection playlist(JSONObject json) {
            int count = json.optInt("songCount", 0);
            return new Collection(PLAYLIST, json.optString("id"), json.optString("name", "Playlist"), count == 1 ? "1 song" : count + " songs", json.optString("coverArt", ""));
        }

        static Collection artist(JSONObject json) {
            int count = json.optInt("albumCount", 0);
            return new Collection(ARTIST, json.optString("id"), json.optString("name", "Unknown"), count == 1 ? "1 album" : count + " albums", json.optString("coverArt", ""));
        }

        static Collection liked() {
            return new Collection(LIKED, "starred", "Liked Songs", "Your favourites", "");
        }

        JSONObject toJson() {
            JSONObject json = new JSONObject();
            try {
                json.put("kind", kind).put("id", id).put("name", name).put("subtitle", subtitle).put("coverArt", coverArt);
            } catch (JSONException ignored) {
                // Strings never fail.
            }
            return json;
        }

        static Collection fromJson(JSONObject json) {
            return new Collection(json.optString("kind"), json.optString("id"), json.optString("name"), json.optString("subtitle"), json.optString("coverArt"));
        }
    }

    static final class Page {
        final Collection collection;
        final List<Song> songs;
        final List<Collection> albums;

        Page(Collection collection, List<Song> songs, List<Collection> albums) {
            this.collection = collection;
            this.songs = songs;
            this.albums = albums;
        }
    }

    static final class SearchResult {
        final List<Song> songs;
        final List<Collection> albums;
        final List<Collection> artists;

        SearchResult(List<Song> songs, List<Collection> albums, List<Collection> artists) {
            this.songs = songs;
            this.albums = albums;
            this.artists = artists;
        }
    }

    static List<Song> songs(JSONArray array) {
        List<Song> list = new ArrayList<>();
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null && !item.optBoolean("isDir", false) && !"video".equals(item.optString("type"))) {
                    list.add(Song.from(item));
                }
            }
        }
        return list;
    }

    interface Mapper {
        Collection map(JSONObject json);
    }

    static List<Collection> collections(JSONArray array, Mapper mapper) {
        List<Collection> list = new ArrayList<>();
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null) {
                    list.add(mapper.map(item));
                }
            }
        }
        return list;
    }
}
