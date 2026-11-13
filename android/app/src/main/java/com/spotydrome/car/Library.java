package com.spotydrome.car;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

// What's saved for offline listening: song files on the SD card, and an index of them and of the collections
// (albums, playlists) they were downloaded with, kept in the app's private storage.
final class Library {

    private static final String TAG = "Library";
    private static final String EXTERNAL_SD = "/mnt/external_sd";

    private static Library instance;

    private final Context context;
    private final File indexFile;
    private final JSONObject songs;
    private final JSONObject collections;

    private Library(Context context) {
        this.context = context.getApplicationContext();
        indexFile = new File(this.context.getFilesDir(), "library.json");
        JSONObject index = load(indexFile);
        songs = index.optJSONObject("songs") != null ? index.optJSONObject("songs") : new JSONObject();
        collections = index.optJSONObject("collections") != null ? index.optJSONObject("collections") : new JSONObject();
    }

    static synchronized Library get(Context context) {
        if (instance == null) {
            instance = new Library(context);
        }
        return instance;
    }

    File storageDir() {
        File external = new File(EXTERNAL_SD);
        File base = new Prefs(context).useExternalSd() && external.canWrite() ? external : Environment.getExternalStorageDirectory();
        File dir = new File(base, "Spotydrome");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            Log.w(TAG, "could not create " + dir);
        }
        return dir;
    }

    boolean externalSdAvailable() {
        return new File(EXTERNAL_SD).canWrite();
    }

    synchronized File fileFor(String songId) {
        JSONObject entry = songs.optJSONObject(songId);
        if (entry == null) {
            return null;
        }
        File file = new File(entry.optString("file"));
        return file.isFile() ? file : null;
    }

    synchronized boolean isDownloaded(String songId) {
        return fileFor(songId) != null;
    }

    File newFileFor(String songId) {
        return new File(storageDir(), songId.replaceAll("[^A-Za-z0-9_-]", "_") + ".mp3");
    }

    synchronized void addSong(Media.Song song, File file) {
        try {
            songs.put(song.id, song.toJson().put("file", file.getAbsolutePath()).put("bytes", file.length()));
            save();
        } catch (JSONException e) {
            Log.w(TAG, "addSong", e);
        }
    }

    synchronized void saveCollection(Media.Collection collection, List<Media.Song> list) {
        try {
            JSONArray ids = new JSONArray();
            JSONArray pending = new JSONArray();
            for (Media.Song song : list) {
                ids.put(song.id);
                pending.put(song.toJson());
            }
            collections.put(collection.key(), new JSONObject().put("collection", collection.toJson()).put("songIds", ids).put("songs", pending).put("savedAt", System.currentTimeMillis()));
            save();
        } catch (JSONException e) {
            Log.w(TAG, "saveCollection", e);
        }
    }

    synchronized boolean hasCollection(String key) {
        return collections.has(key);
    }

    synchronized List<Media.Collection> collections() {
        List<Media.Collection> list = new ArrayList<>();
        for (Iterator<String> keys = collections.keys(); keys.hasNext(); ) {
            JSONObject entry = collections.optJSONObject(keys.next());
            if (entry != null && entry.optJSONObject("collection") != null) {
                list.add(Media.Collection.fromJson(entry.optJSONObject("collection")));
            }
        }
        return list;
    }

    synchronized List<Media.Song> songsOf(String key) {
        List<Media.Song> list = new ArrayList<>();
        JSONObject entry = collections.optJSONObject(key);
        JSONArray all = entry == null ? null : entry.optJSONArray("songs");
        if (all != null) {
            for (int i = 0; i < all.length(); i++) {
                JSONObject song = all.optJSONObject(i);
                if (song != null) {
                    list.add(Media.Song.from(song));
                }
            }
        }
        return list;
    }

    synchronized List<Media.Song> downloadedSongs() {
        List<Media.Song> list = new ArrayList<>();
        for (Iterator<String> keys = songs.keys(); keys.hasNext(); ) {
            JSONObject song = songs.optJSONObject(keys.next());
            if (song != null && new File(song.optString("file")).isFile()) {
                list.add(Media.Song.from(song));
            }
        }
        return list;
    }

    synchronized int[] progressOf(String key) {
        List<Media.Song> list = songsOf(key);
        int done = 0;
        for (Media.Song song : list) {
            if (fileFor(song.id) != null) {
                done++;
            }
        }
        return new int[] {done, list.size()};
    }

    // Deletes the collection, and the files of any of its songs no other saved collection still needs.
    synchronized void removeCollection(String key) {
        Set<String> removed = new HashSet<>();
        for (Media.Song song : songsOf(key)) {
            removed.add(song.id);
        }
        collections.remove(key);
        for (Iterator<String> keys = collections.keys(); keys.hasNext(); ) {
            JSONObject entry = collections.optJSONObject(keys.next());
            JSONArray ids = entry == null ? null : entry.optJSONArray("songIds");
            for (int i = 0; ids != null && i < ids.length(); i++) {
                removed.remove(ids.optString(i));
            }
        }
        for (String id : removed) {
            File file = fileFor(id);
            if (file != null && !file.delete()) {
                Log.w(TAG, "could not delete " + file);
            }
            songs.remove(id);
        }
        save();
    }

    synchronized long usedBytes() {
        long total = 0;
        for (Iterator<String> keys = songs.keys(); keys.hasNext(); ) {
            JSONObject song = songs.optJSONObject(keys.next());
            if (song != null) {
                total += song.optLong("bytes", 0);
            }
        }
        return total;
    }

    private void save() {
        File temporary = new File(indexFile.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temporary)) {
            out.write(new JSONObject().put("songs", songs).put("collections", collections).toString().getBytes("UTF-8"));
            out.getFD().sync();
        } catch (IOException | JSONException e) {
            Log.w(TAG, "could not save the library index", e);
            return;
        }
        if (!temporary.renameTo(indexFile)) {
            Log.w(TAG, "could not replace the library index");
        }
    }

    private static JSONObject load(File file) {
        if (!file.isFile()) {
            return new JSONObject();
        }
        try (FileInputStream in = new FileInputStream(file)) {
            return new JSONObject(Http.readAll(in));
        } catch (IOException | JSONException e) {
            Log.w(TAG, "could not read the library index", e);
            return new JSONObject();
        }
    }
}
