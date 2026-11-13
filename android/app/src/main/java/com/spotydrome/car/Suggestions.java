package com.spotydrome.car;

import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

// Songs to play after one the user picked, like the web app's autoplay: Navidrome's Instant Mix and YouTube Music's radio.
final class Suggestions {

    private static final String TAG = "Suggestions";
    private static final int COUNT = 20;

    private Suggestions() {
    }

    // Blocking; call it off the main thread. Never throws: no suggestions is a normal answer.
    static List<Media.Song> after(Context context, Media.Song seed) {
        Api api = new Api(context);
        List<Media.Song> library = new ArrayList<>();
        List<Media.Song> catalog = new ArrayList<>();
        if (!seed.isExternal()) {
            try {
                library = api.librarySimilar(seed, COUNT);
            } catch (IOException e) {
                Log.d(TAG, "no library suggestions: " + e.getMessage());
            }
        }
        try {
            catalog = api.catalogSimilar(seed, COUNT);
        } catch (IOException e) {
            Log.d(TAG, "no catalog suggestions: " + e.getMessage());
        }
        List<Media.Song> merged = merge(seed, library, catalog);
        if (merged.isEmpty()) {
            return merged;
        }
        try {
            return api.fitToSeed(seed, merged);
        } catch (IOException e) {
            Log.d(TAG, "could not check the suggestions: " + e.getMessage());
            return merged;
        }
    }

    // The two lists are taken in turns, a song in both plays from the library, and the seed itself is never suggested.
    private static List<Media.Song> merge(Media.Song seed, List<Media.Song> library, List<Media.Song> catalog) {
        Set<String> seen = new HashSet<>();
        seen.add(seed.key());
        for (Media.Song song : library) {
            seen.add(song.key());
        }
        Set<String> added = new HashSet<>();
        added.add(seed.key());
        List<Media.Song> merged = new ArrayList<>();
        for (int i = 0; i < Math.max(library.size(), catalog.size()) && merged.size() < COUNT; i++) {
            if (i < library.size() && added.add(library.get(i).key())) {
                merged.add(library.get(i));
            }
            if (i < catalog.size() && seen.add(catalog.get(i).key())) {
                merged.add(catalog.get(i));
            }
        }
        return merged;
    }
}
