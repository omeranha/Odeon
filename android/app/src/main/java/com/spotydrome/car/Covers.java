package com.spotydrome.car;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Cover art, kept small for a 512 MB tablet: decoded at display size, cached in memory and on disk so covers
// also show offline. Library covers come from Navidrome; songs not in the library yet have a direct image URL.
final class Covers {

    static final int SMALL = 160;
    static final int LARGE = 400;

    interface BitmapCallback {
        void onBitmap(Bitmap bitmap);
    }

    private static final String TAG = "Covers";
    private static Covers instance;

    private final Context context;
    private final Api api;
    private final File dir;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final LruCache<String, Bitmap> memory;

    private Covers(Context context) {
        this.context = context.getApplicationContext();
        api = new Api(context);
        dir = new File(this.context.getCacheDir(), "covers");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            Log.w(TAG, "no cover cache directory");
        }
        int budget = (int) Math.min(Runtime.getRuntime().maxMemory() / 6, 8L * 1024 * 1024);
        memory = new LruCache<String, Bitmap>(budget) {
            @Override
            protected int sizeOf(String key, Bitmap bitmap) {
                return bitmap.getRowBytes() * bitmap.getHeight();
            }
        };
    }

    static synchronized Covers get(Context context) {
        if (instance == null) {
            instance = new Covers(context);
        }
        return instance;
    }

    private static final class Source {
        final String key;
        final String url;

        Source(String key, String url) {
            this.key = key;
            this.url = url;
        }
    }

    private Source library(String coverArt, int size) {
        return coverArt == null || coverArt.isEmpty() ? null : new Source(coverArt.replaceAll("[^A-Za-z0-9_-]", "_") + "_" + size, api.coverUrl(coverArt, size));
    }

    private static Source direct(String url) {
        return url == null || !url.startsWith("https://") ? null : new Source("u" + sha1(url), url);
    }

    private Source sourceFor(Media.Song song, int size) {
        return song.isExternal() ? direct(song.coverUrl) : library(song.coverArt, size);
    }

    void load(ImageView view, String coverArt, int size, int placeholder) {
        show(view, library(coverArt, size), placeholder);
    }

    void load(ImageView view, Media.Song song, int size, int placeholder) {
        show(view, sourceFor(song, size), placeholder);
    }

    // Delivers the cover on the main thread, or null when there's none.
    void bitmap(Media.Song song, int size, BitmapCallback callback) {
        Source source = sourceFor(song, size);
        Bitmap cached = source == null ? null : memory.get(source.key);
        if (source == null || cached != null) {
            main.post(() -> callback.onBitmap(cached));
            return;
        }
        workers.execute(() -> {
            Bitmap bitmap = fetch(source);
            if (bitmap != null) {
                memory.put(source.key, bitmap);
            }
            main.post(() -> callback.onBitmap(bitmap));
        });
    }

    private void show(ImageView view, Source source, int placeholder) {
        String key = source == null ? null : source.key;
        view.setTag(R.id.cover_key, key);
        Bitmap cached = key == null ? null : memory.get(key);
        if (cached != null) {
            view.setImageBitmap(cached);
            return;
        }
        view.setImageResource(placeholder);
        if (source == null) {
            return;
        }
        workers.execute(() -> {
            Bitmap bitmap = fetch(source);
            if (bitmap == null) {
                return;
            }
            memory.put(source.key, bitmap);
            main.post(() -> {
                if (source.key.equals(view.getTag(R.id.cover_key))) {
                    view.setImageBitmap(bitmap);
                }
            });
        });
    }

    // Saves the cover to disk without decoding it, so it shows later without a connection.
    void prefetch(String coverArt, int size) {
        Source source = library(coverArt, size);
        if (source == null) {
            return;
        }
        File file = new File(dir, source.key + ".jpg");
        if (!file.isFile()) {
            try {
                download(source.url, file);
            } catch (IOException e) {
                Log.d(TAG, "cover " + coverArt + ": " + e.getMessage());
            }
        }
    }

    private Bitmap fetch(Source source) {
        File file = new File(dir, source.key + ".jpg");
        if (!file.isFile()) {
            if (new Prefs(context).offlineOnly()) {
                return null;
            }
            try {
                download(source.url, file);
            } catch (IOException e) {
                Log.d(TAG, "cover " + source.key + ": " + e.getMessage());
                return null;
            }
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getPath(), bounds);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inPreferredConfig = Bitmap.Config.RGB_565;
        // Direct URLs can be large (YouTube thumbnails); decode them close to the largest size shown.
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= LARGE) {
            sample *= 2;
        }
        options.inSampleSize = sample;
        return BitmapFactory.decodeFile(file.getPath(), options);
    }

    private void download(String url, File file) throws IOException {
        HttpURLConnection connection = Http.open(context, url);
        File part = new File(file.getPath() + ".part");
        try {
            String type = connection.getContentType();
            if (connection.getResponseCode() != 200 || type == null || !type.startsWith("image/")) {
                throw new IOException("no cover");
            }
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[16 * 1024];
                for (int read; (read = in.read(buffer)) > 0; ) {
                    out.write(buffer, 0, read);
                }
            }
            if (!part.renameTo(file)) {
                throw new IOException("could not save cover");
            }
        } finally {
            connection.disconnect();
            if (part.exists() && !part.delete()) {
                Log.w(TAG, "could not delete " + part);
            }
        }
    }

    private static String sha1(String text) {
        try {
            return new BigInteger(1, MessageDigest.getInstance("SHA-1").digest(text.getBytes("UTF-8"))).toString(16);
        } catch (NoSuchAlgorithmException | UnsupportedEncodingException e) {
            return String.valueOf(text.hashCode());
        }
    }

    void clearMemory() {
        memory.evictAll();
    }
}
