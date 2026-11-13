package com.spotydrome.car;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class DownloadService extends Service {

    private static final String TAG = "DownloadService";
    private static final String ACTION_DOWNLOAD = "com.spotydrome.car.DOWNLOAD";
    private static final String ACTION_SYNC_ALL = "com.spotydrome.car.SYNC_ALL";
    private static final String ACTION_CANCEL = "com.spotydrome.car.CANCEL_DOWNLOADS";
    private static final String EXTRA_COLLECTION = "collection";
    private static final int NOTIFICATION_ID = 2;

    private static final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static volatile String status = "";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean cancelled;
    private int pendingJobs;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    static void download(Context context, Media.Collection collection) {
        context.startService(new Intent(context, DownloadService.class).setAction(ACTION_DOWNLOAD).putExtra(EXTRA_COLLECTION, collection.toJson().toString()));
    }

    static void syncAll(Context context) {
        context.startService(new Intent(context, DownloadService.class).setAction(ACTION_SYNC_ALL));
    }

    static void cancel(Context context) {
        context.startService(new Intent(context, DownloadService.class).setAction(ACTION_CANCEL));
    }

    static String status() {
        return status;
    }

    static void addListener(Runnable listener) {
        listeners.add(listener);
    }

    static void removeListener(Runnable listener) {
        listeners.remove(listener);
    }

    private static void publish(String text) {
        status = text;
        main.post(() -> {
            for (Runnable listener : listeners) {
                listener.run();
            }
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "odeon:downloads");
        wifiLock = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL, "odeon:downloads");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_CANCEL.equals(action)) {
            cancelled = true;
            return START_NOT_STICKY;
        }
        List<Media.Collection> jobs = new ArrayList<>();
        if (ACTION_DOWNLOAD.equals(action)) {
            try {
                jobs.add(Media.Collection.fromJson(new JSONObject(intent.getStringExtra(EXTRA_COLLECTION))));
            } catch (JSONException | NullPointerException e) {
                Log.w(TAG, "bad download request", e);
            }
        } else if (ACTION_SYNC_ALL.equals(action)) {
            jobs.addAll(Library.get(this).collections());
        }
        if (jobs.isEmpty()) {
            if (pendingJobs == 0) {
                stopSelf();
            }
            return START_NOT_STICKY;
        }
        cancelled = false;
        startForeground(NOTIFICATION_ID, notification(getString(R.string.downloads_starting), 0, 0));
        acquireLocks();
        for (Media.Collection job : jobs) {
            pendingJobs++;
            worker.execute(() -> {
                try {
                    if (!cancelled) {
                        run(job);
                    }
                } finally {
                    main.post(this::jobFinished);
                }
            });
        }
        return START_NOT_STICKY;
    }

    private void jobFinished() {
        pendingJobs--;
        if (pendingJobs <= 0) {
            publish(cancelled ? getString(R.string.downloads_cancelled) : "");
            releaseLocks();
            stopForeground(true);
            stopSelf();
        }
    }

    private void run(Media.Collection collection) {
        Api api = new Api(this);
        Library library = Library.get(this);
        List<Media.Song> songs = new ArrayList<>();
        try {
            Media.Page page = api.page(collection);
            songs.addAll(page.songs);
            for (Media.Collection album : page.albums) {
                songs.addAll(api.page(album).songs);
            }
            library.saveCollection(page.collection, songs);
        } catch (IOException e) {
            Log.w(TAG, "could not list " + collection.key(), e);
            publish(getString(R.string.download_failed, collection.name, e.getMessage()));
            return;
        }
        int bitrate = new Prefs(this).downloadBitrate();
        Covers covers = Covers.get(this);
        covers.prefetch(collection.coverArt, Covers.SMALL);
        covers.prefetch(collection.coverArt, Covers.LARGE);
        Set<String> coversSaved = new HashSet<>();
        int done = 0;
        int failed = 0;
        for (Media.Song song : songs) {
            if (cancelled) {
                return;
            }
            String line = getString(R.string.downloading_progress, collection.name, done + 1, songs.size());
            publish(line);
            updateNotification(line, done, songs.size());
            if (coversSaved.add(song.coverArt)) {
                covers.prefetch(song.coverArt, Covers.SMALL);
                covers.prefetch(song.coverArt, Covers.LARGE);
            }
            if (!library.isDownloaded(song.id)) {
                try {
                    fetch(api.streamUrl(song.id, bitrate, 0), library.newFileFor(song.id), song, library);
                } catch (IOException e) {
                    failed++;
                    Log.w(TAG, "download failed for " + song.id, e);
                }
            }
            done++;
        }
        publish(failed > 0 ? getString(R.string.download_partial, collection.name, failed) : getString(R.string.download_done, collection.name));
    }

    private void fetch(String url, File target, Media.Song song, Library library) throws IOException {
        File part = new File(target.getPath() + ".part");
        HttpURLConnection connection = Http.open(this, url);
        connection.setReadTimeout(120_000);
        try {
            int code = connection.getResponseCode();
            String type = connection.getContentType();
            if (code != 200 || type == null || !type.startsWith("audio/")) {
                throw new IOException("HTTP " + code + " " + type);
            }
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[32 * 1024];
                for (int read; (read = in.read(buffer)) > 0; ) {
                    if (cancelled) {
                        throw new IOException("cancelled");
                    }
                    out.write(buffer, 0, read);
                }
                out.getFD().sync();
            }
            if (part.length() == 0 || !part.renameTo(target)) {
                throw new IOException("could not save " + target);
            }
            library.addSong(song, target);
        } finally {
            connection.disconnect();
            if (part.exists() && !part.delete()) {
                Log.w(TAG, "could not delete " + part);
            }
        }
    }

    private void updateNotification(String text, int done, int total) {
        main.post(() -> startForeground(NOTIFICATION_ID, notification(text, done, total)));
    }

    @SuppressWarnings("deprecation")
    private Notification notification(String text, int done, int total) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent cancel = PendingIntent.getService(this, 1, new Intent(this, DownloadService.class).setAction(ACTION_CANCEL), PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this).setSmallIcon(R.drawable.ic_download).setContentTitle(getString(R.string.app_name)).setContentText(text).setProgress(total, done, total == 0).setOngoing(true).setContentIntent(open).addAction(R.drawable.ic_close, getString(R.string.cancel), cancel).build();
    }

    private void acquireLocks() {
        if (!wakeLock.isHeld()) {
            wakeLock.acquire();
        }
        if (!wifiLock.isHeld()) {
            wifiLock.acquire();
        }
    }

    private void releaseLocks() {
        if (wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (wifiLock.isHeld()) {
            wifiLock.release();
        }
    }

    @Override
    public void onDestroy() {
        cancelled = true;
        worker.shutdownNow();
        releaseLocks();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
