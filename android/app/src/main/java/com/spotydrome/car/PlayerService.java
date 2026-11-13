package com.spotydrome.car;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.RemoteControlClient;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;

public final class PlayerService extends Service implements AudioManager.OnAudioFocusChangeListener {

    interface Listener {
        void onPlayerChanged();
    }

    static final int REPEAT_OFF = 0;
    static final int REPEAT_ALL = 1;
    static final int REPEAT_ONE = 2;

    static final String ACTION_STATE = "com.spotydrome.car.STATE";

    private static final String TAG = "PlayerService";
    private static final String ACTION_PLAY_QUEUE = "com.spotydrome.car.PLAY_QUEUE";
    private static final String ACTION_TOGGLE = "com.spotydrome.car.TOGGLE";
    private static final String ACTION_PLAY = "com.spotydrome.car.PLAY";
    private static final String ACTION_PAUSE = "com.spotydrome.car.PAUSE";
    private static final String ACTION_NEXT = "com.spotydrome.car.NEXT";
    private static final String ACTION_PREVIOUS = "com.spotydrome.car.PREVIOUS";
    private static final String ACTION_RESUME_SAVED = "com.spotydrome.car.RESUME_SAVED";
    private static final String ACTION_POWER_LOST = "com.spotydrome.car.POWER_LOST";
    private static final int NOTIFICATION_ID = 1;
    private static final int RESTART_THRESHOLD_MS = 4000;
    private static final long SAVE_INTERVAL_MS = 10_000;
    private static final float DUCK_VOLUME = 0.2f;
    private static final int MAX_RECOVERIES = 3;
    private static final int EARLY_END_MS = 5000;
    // Small enough for a broadcast extra, big enough for DLdash's cover.
    private static final int BROADCAST_COVER_PX = 200;

    private static final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private static PlayerService instance;
    private static List<Media.Song> pendingQueue;
    private static int pendingIndex;
    private static boolean pendingSuggestions;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Media.Song> queue = new ArrayList<>();
    private final Random random = new Random();
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            pause(true);
        }
    };
    private final Runnable saveTicker = new Runnable() {
        @Override
        public void run() {
            saveQueue();
            handler.postDelayed(this, SAVE_INTERVAL_MS);
        }
    };

    private int[] order = new int[0];
    private int cursor;
    private boolean shuffle;
    private int repeat = REPEAT_OFF;
    private MediaPlayer player;
    private boolean prepared;
    private boolean playing;
    private boolean pausedForFocus;
    private boolean streaming;
    private boolean fromNetwork;
    private int streamOffsetMs;
    private int pendingSeekMs;
    // MediaPlayer seeks asynchronously and older builds report the old position until it lands.
    private int seekTargetMs = -1;
    // Catalog ids already sent to Downtify's stream cache this session; touched on the main thread only.
    private final Set<String> prefetched = new HashSet<>();
    private int recoveries;
    private String error;
    private Prefs prefs;
    private Api api;
    private StreamProxy proxy;
    private AudioManager audio;
    private RemoteControlClient remote;
    private ComponentName mediaButtons;
    private WifiManager.WifiLock wifiLock;
    private boolean noisyRegistered;
    private RemoteLink remoteLink;
    private String coverFor;
    private Bitmap cover;

    // ---- Commands from the UI. Everything runs on the main thread.

    static void playQueue(Context context, List<Media.Song> songs, int index) {
        pendingQueue = new ArrayList<>(songs);
        pendingIndex = index;
        pendingSuggestions = false;
        context.startService(new Intent(context, PlayerService.class).setAction(ACTION_PLAY_QUEUE));
    }

    // Plays one song, then songs similar to it instead of whatever list it was picked from.
    static void playWithSuggestions(Context context, Media.Song song) {
        pendingQueue = new ArrayList<>(Collections.singletonList(song));
        pendingIndex = 0;
        pendingSuggestions = true;
        context.startService(new Intent(context, PlayerService.class).setAction(ACTION_PLAY_QUEUE));
    }

    static void command(Context context, String action) {
        context.startService(new Intent(context, PlayerService.class).setAction(action));
    }

    static void toggle(Context context) {
        command(context, ACTION_TOGGLE);
    }

    static void next(Context context) {
        command(context, ACTION_NEXT);
    }

    static void previous(Context context) {
        command(context, ACTION_PREVIOUS);
    }

    static void resumeSaved(Context context) {
        command(context, ACTION_RESUME_SAVED);
    }

    static void powerLost(Context context) {
        if (instance != null) {
            command(context, ACTION_POWER_LOST);
        }
    }

    static PlayerService current() {
        return instance;
    }

    static void addListener(Listener listener) {
        listeners.add(listener);
    }

    static void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    // ---- State read by the UI.

    Media.Song song() {
        return order.length == 0 ? null : queue.get(order[cursor]);
    }

    List<Media.Song> upcoming() {
        List<Media.Song> list = new ArrayList<>();
        for (int i = cursor; i < order.length; i++) {
            list.add(queue.get(order[i]));
        }
        return list;
    }

    boolean isPlaying() {
        return playing;
    }

    boolean isLoading() {
        return order.length > 0 && !prepared;
    }

    boolean isShuffle() {
        return shuffle;
    }

    int repeatMode() {
        return repeat;
    }

    String takeError() {
        String message = error;
        error = null;
        return message;
    }

    int positionMs() {
        if (player == null || !prepared) {
            return streaming && player != null ? streamOffsetMs : pendingSeekMs;
        }
        try {
            return seekTargetMs >= 0 ? seekTargetMs : streamOffsetMs + player.getCurrentPosition();
        } catch (IllegalStateException e) {
            return streamOffsetMs;
        }
    }

    int durationMs() {
        Media.Song song = song();
        if (player != null && prepared && !streaming) {
            try {
                return player.getDuration();
            } catch (IllegalStateException ignored) {
                // Falls back to the server's duration.
            }
        }
        return song == null ? 0 : song.durationSeconds * 1000;
    }

    void seekTo(int positionMs) {
        if (song() == null) {
            return;
        }
        if (player != null && prepared && !streaming) {
            seekTargetMs = positionMs;
            player.seekTo(positionMs);
        } else {
            load(positionMs, playing || !prepared);
        }
        notifyChanged();
    }

    void toggleShuffle() {
        shuffle = !shuffle;
        int current = order.length == 0 ? 0 : order[cursor];
        buildOrder(current);
        saveQueue();
        notifyChanged();
    }

    void cycleRepeat() {
        repeat = (repeat + 1) % 3;
        saveQueue();
        notifyChanged();
    }

    void jumpTo(int offsetInUpcoming) {
        if (cursor + offsetInUpcoming < order.length) {
            cursor += offsetInUpcoming;
            load(0, true);
        }
    }

    private void previousOrRestart() {
        if (positionMs() > RESTART_THRESHOLD_MS || cursor == 0) {
            seekTo(0);
        } else {
            cursor--;
            load(0, playing || !prepared);
        }
    }

    // Commands sent from Odeon on the user's phone, through the server.
    void applyRemote(JSONObject command) {
        switch (command.optString("type")) {
            case "toggle":
                if (playing) {
                    pause(true);
                } else {
                    play();
                }
                break;
            case "play":
                play();
                break;
            case "pause":
                if (playing) {
                    pause(true);
                }
                break;
            case "next":
                skip(true);
                break;
            case "previous":
                previousOrRestart();
                break;
            case "seek":
                seekTo(Math.max(0, Math.min(command.optInt("positionMs"), durationMs())));
                break;
            case "jump":
                jumpTo(Math.max(0, command.optInt("index")));
                break;
            case "shuffle":
                toggleShuffle();
                break;
            case "repeat":
                cycleRepeat();
                break;
            case "playQueue":
            case "transfer":
                List<Media.Song> songs = Media.songs(command.optJSONArray("songs"));
                if (!songs.isEmpty()) {
                    // Playback moved here keeps the other device's order, so shuffle isn't re-applied on top of it.
                    shuffle = false;
                    setQueue(songs, command.optInt("startIndex"));
                    load(Math.max(0, command.optInt("positionMs")), command.optBoolean("playing", true));
                }
                break;
            default:
                break;
        }
    }

    JSONObject remoteState() {
        JSONObject state = new JSONObject();
        try {
            Media.Song song = song();
            JSONArray next = new JSONArray();
            List<Media.Song> upcoming = upcoming();
            for (int i = 0; i < Math.min(200, upcoming.size()); i++) {
                next.put(upcoming.get(i).toJson());
            }
            state.put("song", song == null ? JSONObject.NULL : song.toJson()).put("playing", playing).put("positionMs", positionMs()).put("durationMs", durationMs()).put("shuffle", shuffle).put("repeat", repeat == REPEAT_ALL ? "all" : repeat == REPEAT_ONE ? "one" : "off").put("upcoming", next);
        } catch (JSONException ignored) {
            // Only non-finite numbers fail.
        }
        return state;
    }

    // ---- Service lifecycle.

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        prefs = new Prefs(this);
        api = new Api(this);
        proxy = new StreamProxy(this);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        wifiLock = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL, "odeon:stream");
        mediaButtons = new ComponentName(this, MediaButtonReceiver.class);
        // Claimed right away, so the launcher's play button reaches this app after a restart, before anything plays.
        audio.registerMediaButtonEventReceiver(mediaButtons);
        loadSavedQueue();
        handler.postDelayed(saveTicker, SAVE_INTERVAL_MS);
        handler.post(this::notifyChanged);
        if (prefs.signedIn()) {
            remoteLink = new RemoteLink(this);
            remoteLink.start();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) {
            return START_NOT_STICKY;
        }
        switch (action) {
            case ACTION_PLAY_QUEUE:
                if (pendingQueue != null) {
                    setQueue(pendingQueue, pendingIndex);
                    boolean suggest = pendingSuggestions;
                    pendingQueue = null;
                    pendingSuggestions = false;
                    load(0, true);
                    if (suggest) {
                        suggestAfter(song());
                    }
                }
                break;
            case ACTION_TOGGLE:
                if (playing) {
                    pause(true);
                } else {
                    play();
                }
                break;
            case ACTION_PLAY:
                play();
                break;
            case ACTION_PAUSE:
                pause(true);
                break;
            case ACTION_NEXT:
                skip(true);
                break;
            case ACTION_PREVIOUS:
                previousOrRestart();
                break;
            case ACTION_RESUME_SAVED:
                if (!playing && song() != null) {
                    play();
                }
                break;
            case ACTION_POWER_LOST:
                if (playing) {
                    pause(false);
                }
                break;
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (remoteLink != null) {
            remoteLink.stop();
        }
        saveQueue();
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        proxy.stop();
        if (remote != null) {
            audio.unregisterRemoteControlClient(remote);
        }
        audio.unregisterMediaButtonEventReceiver(mediaButtons);
        audio.abandonAudioFocus(this);
        unregisterNoisy();
        sendStickyState(null, false);
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- Playback.

    private void setQueue(List<Media.Song> songs, int index) {
        queue.clear();
        queue.addAll(songs);
        buildOrder(Math.max(0, Math.min(index, songs.size() - 1)));
    }

    // The order lists queue positions; with shuffle on, the current song stays first and the rest are mixed.
    private void buildOrder(int startPosition) {
        int size = queue.size();
        order = new int[size];
        if (size == 0) {
            cursor = 0;
            return;
        }
        if (!shuffle) {
            for (int i = 0; i < size; i++) {
                order[i] = i;
            }
            cursor = startPosition;
            return;
        }
        List<Integer> rest = new ArrayList<>();
        for (int i = 0; i < size; i++) {
            if (i != startPosition) {
                rest.add(i);
            }
        }
        Collections.shuffle(rest, random);
        order[0] = startPosition;
        for (int i = 0; i < rest.size(); i++) {
            order[i + 1] = rest.get(i);
        }
        cursor = 0;
    }

    boolean online() {
        if (prefs.offlineOnly()) {
            return false;
        }
        NetworkInfo network = ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).getActiveNetworkInfo();
        return network != null && network.isConnected();
    }

    private void load(int startMs, boolean autoplay) {
        load(startMs, autoplay, false);
    }

    private void load(int startMs, boolean autoplay, boolean recovering) {
        if (!recovering) {
            recoveries = 0;
        }
        Media.Song song = song();
        releasePlayer();
        if (song == null) {
            notifyChanged();
            return;
        }
        File local = Library.get(this).fileFor(song.id);
        if (local == null && !online()) {
            if (!skipToPlayable()) {
                error = getString(R.string.nothing_downloaded_to_play);
                playing = false;
                notifyChanged();
                return;
            }
            song = song();
            local = Library.get(this).fileFor(song.id);
            startMs = 0;
        }
        playing = autoplay;
        prepared = false;
        // Navidrome's transcoded streams seek by restarting at an offset; files, Downtify's MP4 and MP3s Navidrome sends
        // as-is seek directly.
        boolean libraryStream = local == null && !song.isExternal();
        boolean sentAsIs = libraryStream && song.streamsAsIs(prefs.streamBitrate());
        streaming = libraryStream && !sentAsIs;
        fromNetwork = local == null;
        streamOffsetMs = 0;
        pendingSeekMs = startMs;
        MediaPlayer media = new MediaPlayer();
        player = media;
        media.setAudioStreamType(AudioManager.STREAM_MUSIC);
        media.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        media.setOnPreparedListener(this::onPrepared);
        media.setOnSeekCompleteListener(mp -> {
            if (mp == player) {
                seekTargetMs = -1;
            }
        });
        media.setOnCompletionListener(mp -> onCompleted());
        media.setOnErrorListener((mp, what, extra) -> onPlaybackError(what, extra));
        try {
            if (local != null) {
                try (FileInputStream in = new FileInputStream(local)) {
                    media.setDataSource(in.getFD());
                }
            } else if (song.isExternal()) {
                media.setDataSource(proxy.localUrlFor(api.catalogStreamUrl(song)));
                if (!wifiLock.isHeld()) {
                    wifiLock.acquire();
                }
            } else {
                int offsetSeconds = sentAsIs ? 0 : startMs / 1000;
                if (!sentAsIs) {
                    streamOffsetMs = offsetSeconds * 1000;
                    pendingSeekMs = 0;
                }
                media.setDataSource(proxy.localUrlFor(api.streamUrl(song.id, prefs.streamBitrate(), offsetSeconds)));
                if (!wifiLock.isHeld()) {
                    wifiLock.acquire();
                }
            }
            media.prepareAsync();
        } catch (IOException | IllegalStateException e) {
            Log.w(TAG, "could not open " + song.id, e);
            onPlaybackError(0, 0);
            return;
        }
        if (autoplay) {
            prefs.setWasPlaying(true);
            startForegroundNotification();
        }
        updateRemote();
        saveQueue();
        notifyChanged();
    }

    private void onPrepared(MediaPlayer media) {
        if (media != player) {
            return;
        }
        prepared = true;
        if (pendingSeekMs > 0) {
            seekTargetMs = pendingSeekMs;
            media.seekTo(pendingSeekMs);
            pendingSeekMs = 0;
        }
        if (playing) {
            startPlayback();
        }
        prefetchNext();
        notifyChanged();
    }

    // Downtify downloads a whole song before serving its first byte, so the next one is fetched while this one plays.
    private void prefetchNext() {
        List<Media.Song> upcoming = upcoming();
        Media.Song next = upcoming.size() > 1 ? upcoming.get(1) : null;
        if (next == null || !next.isExternal() || !prefetched.add(next.catalogId)) {
            return;
        }
        Thread worker = new Thread(() -> {
            try {
                api.prefetchCatalogSong(next);
            } catch (IOException e) {
                Log.d(TAG, "prefetch failed: " + e.getMessage());
                handler.post(() -> prefetched.remove(next.catalogId));
            }
        }, "prefetch");
        worker.setDaemon(true);
        worker.start();
    }

    private void suggestAfter(Media.Song seed) {
        if (seed == null || !online()) {
            return;
        }
        Thread worker = new Thread(() -> {
            List<Media.Song> songs = Suggestions.after(this, seed);
            handler.post(() -> appendSuggestions(seed, songs));
        }, "suggestions");
        worker.setDaemon(true);
        worker.start();
    }

    private void appendSuggestions(Media.Song seed, List<Media.Song> songs) {
        // Picking something else while these loaded replaced the queue, and they no longer belong to it.
        if (songs.isEmpty() || queue.size() != 1 || queue.get(0) != seed) {
            return;
        }
        queue.addAll(songs);
        buildOrder(0);
        prefetchNext();
        saveQueue();
        notifyChanged();
    }

    private void startPlayback() {
        if (audio.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            playing = false;
            notifyChanged();
            return;
        }
        registerRemote();
        registerNoisy();
        player.setVolume(1f, 1f);
        player.start();
        playing = true;
        pausedForFocus = false;
        prefs.setWasPlaying(true);
        startForegroundNotification();
        updateRemote();
    }

    private void play() {
        if (song() == null) {
            return;
        }
        if (player == null) {
            load(pendingSeekMs, true);
            return;
        }
        playing = true;
        if (prepared) {
            startPlayback();
        }
        notifyChanged();
    }

    // A deliberate pause forgets that music was playing; a power cut keeps it, so power-on can resume.
    private void pause(boolean deliberate) {
        if (player != null && prepared && player.isPlaying()) {
            player.pause();
        }
        playing = false;
        if (deliberate) {
            prefs.setWasPlaying(false);
        }
        unregisterNoisy();
        if (wifiLock.isHeld()) {
            wifiLock.release();
        }
        stopForeground(false);
        showNotification();
        updateRemote();
        saveQueue();
        notifyChanged();
    }

    private void skip(boolean userAsked) {
        if (order.length == 0) {
            return;
        }
        if (!userAsked && repeat == REPEAT_ONE) {
            load(0, true);
            return;
        }
        if (cursor + 1 < order.length) {
            cursor++;
            load(0, userAsked ? playing || !prepared : true);
        } else if (repeat == REPEAT_ALL || userAsked) {
            cursor = 0;
            load(0, repeat == REPEAT_ALL ? true : playing);
        } else {
            pause(true);
            seekToStartWithoutPlaying();
        }
    }

    private void seekToStartWithoutPlaying() {
        cursor = 0;
        load(0, false);
    }

    private boolean skipToPlayable() {
        Library library = Library.get(this);
        for (int step = 0; step < order.length; step++) {
            int candidate = (cursor + step) % order.length;
            if (library.fileFor(queue.get(order[candidate]).id) != null) {
                cursor = candidate;
                return true;
            }
        }
        return false;
    }

    private void onCompleted() {
        // A transcoded stream whose connection drops just ends; far from the song's end that's an interruption, not the end.
        Media.Song song = song();
        int position = positionMs();
        if (fromNetwork && song != null && song.durationSeconds > 0 && position < song.durationSeconds * 1000 - EARLY_END_MS && recover(position)) {
            return;
        }
        skip(false);
    }

    // Reloads the song where it stopped, with growing pauses, before giving up on it.
    private boolean recover(int position) {
        if (recoveries >= MAX_RECOVERIES || !online()) {
            return false;
        }
        recoveries++;
        Log.w(TAG, "stream interrupted at " + position + " ms, retry " + recoveries);
        releasePlayer();
        // Saves, state reports and a play() during the wait read this instead of starting the song over.
        pendingSeekMs = position;
        handler.postDelayed(() -> load(position, true, true), 1500L * recoveries);
        return true;
    }

    private boolean onPlaybackError(int what, int extra) {
        Media.Song song = song();
        Log.w(TAG, "playback error " + what + "/" + extra + " for " + (song == null ? "-" : song.id));
        int position = positionMs();
        if (fromNetwork && recover(position)) {
            return true;
        }
        releasePlayer();
        error = getString(R.string.could_not_play, song == null ? "" : song.title);
        recoveries = 0;
        if (cursor + 1 < order.length) {
            cursor++;
            handler.postDelayed(() -> load(0, true), 500);
        } else {
            playing = false;
            notifyChanged();
        }
        return true;
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.reset();
            } catch (IllegalStateException ignored) {
                // Released already.
            }
            player.release();
            player = null;
        }
        prepared = false;
        seekTargetMs = -1;
    }

    @Override
    public void onAudioFocusChange(int change) {
        if (player == null) {
            return;
        }
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (prepared) {
                    player.setVolume(DUCK_VOLUME, DUCK_VOLUME);
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (playing) {
                    pause(false);
                    pausedForFocus = true;
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                if (playing) {
                    pause(true);
                }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (prepared) {
                    player.setVolume(1f, 1f);
                }
                if (pausedForFocus) {
                    pausedForFocus = false;
                    play();
                }
                break;
            default:
                break;
        }
    }

    private void registerNoisy() {
        if (!noisyRegistered) {
            registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            noisyRegistered = true;
        }
    }

    private void unregisterNoisy() {
        if (noisyRegistered) {
            unregisterReceiver(noisyReceiver);
            noisyRegistered = false;
        }
    }

    // ---- Media buttons, lock screen and the DLdash launcher.

    @SuppressWarnings("deprecation")
    private void registerRemote() {
        audio.registerMediaButtonEventReceiver(mediaButtons);
        if (remote == null) {
            Intent buttons = new Intent(Intent.ACTION_MEDIA_BUTTON).setComponent(mediaButtons);
            remote = new RemoteControlClient(PendingIntent.getBroadcast(this, 0, buttons, 0));
            remote.setTransportControlFlags(RemoteControlClient.FLAG_KEY_MEDIA_PLAY | RemoteControlClient.FLAG_KEY_MEDIA_PAUSE | RemoteControlClient.FLAG_KEY_MEDIA_PLAY_PAUSE | RemoteControlClient.FLAG_KEY_MEDIA_NEXT | RemoteControlClient.FLAG_KEY_MEDIA_PREVIOUS);
            audio.registerRemoteControlClient(remote);
        }
    }

    @SuppressWarnings("deprecation")
    private void updateRemote() {
        Media.Song song = song();
        refreshCover(song);
        sendStickyState(song, playing);
        if (remote == null) {
            return;
        }
        remote.setPlaybackState(playing ? RemoteControlClient.PLAYSTATE_PLAYING : RemoteControlClient.PLAYSTATE_PAUSED);
        if (song != null) {
            RemoteControlClient.MetadataEditor editor = remote.editMetadata(true).putString(MediaMetadataRetriever.METADATA_KEY_TITLE, song.title).putString(MediaMetadataRetriever.METADATA_KEY_ARTIST, song.artist).putString(MediaMetadataRetriever.METADATA_KEY_ALBUM, song.album).putLong(MediaMetadataRetriever.METADATA_KEY_DURATION, song.durationSeconds * 1000L);
            if (cover != null) {
                editor.putBitmap(RemoteControlClient.MetadataEditor.BITMAP_KEY_ARTWORK, cover);
            }
            editor.apply();
        }
    }

    // Loads the current song's cover once per song, then re-sends the state so DLdash and the lock screen show it.
    private void refreshCover(Media.Song song) {
        String key = song == null ? null : song.id;
        if (key == null ? coverFor == null : key.equals(coverFor)) {
            return;
        }
        coverFor = key;
        cover = null;
        if (song == null) {
            return;
        }
        Covers.get(this).bitmap(song, Covers.LARGE, bitmap -> {
            if (!key.equals(coverFor) || bitmap == null) {
                return;
            }
            cover = Bitmap.createScaledBitmap(bitmap, BROADCAST_COVER_PX, BROADCAST_COVER_PX, true);
            updateRemote();
        });
    }

    // Sticky, so DLdash shows the current song as soon as its home screen registers, even after a restart.
    @SuppressWarnings("deprecation")
    private void sendStickyState(Media.Song song, boolean isPlaying) {
        Intent state = new Intent(ACTION_STATE).putExtra("playing", isPlaying);
        if (song != null) {
            state.putExtra("title", song.title).putExtra("artist", song.artist).putExtra("album", song.album);
            if (cover != null) {
                state.putExtra("cover", cover);
            }
        }
        sendStickyBroadcast(state);
    }

    private void startForegroundNotification() {
        Notification notification = buildNotification();
        if (notification != null) {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void showNotification() {
        Notification notification = buildNotification();
        if (notification != null) {
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Media.Song song = song();
        if (song == null) {
            return null;
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this)
                .setSmallIcon(R.drawable.ic_music_note)
                .setContentTitle(song.title)
                .setContentText(song.artist)
                .setContentIntent(open)
                .setOngoing(playing)
                .addAction(R.drawable.ic_skip_previous, "", servicePending(ACTION_PREVIOUS, 1))
                .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, "", servicePending(ACTION_TOGGLE, 2))
                .addAction(R.drawable.ic_skip_next, "", servicePending(ACTION_NEXT, 3))
                .build();
    }

    private PendingIntent servicePending(String action, int requestCode) {
        return PendingIntent.getService(this, requestCode, new Intent(this, PlayerService.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void notifyChanged() {
        for (Listener listener : listeners) {
            listener.onPlayerChanged();
        }
        if (remoteLink != null) {
            remoteLink.stateChanged();
        }
        if (playing || song() != null) {
            showNotificationIfBackground();
        }
    }

    private void showNotificationIfBackground() {
        if (playing) {
            startForegroundNotification();
        }
    }

    // ---- Saved queue, so the car picks up where it stopped.

    private File queueFile() {
        return new File(getFilesDir(), "queue.json");
    }

    private void saveQueue() {
        try {
            JSONArray songs = new JSONArray();
            for (Media.Song song : queue) {
                songs.put(song.toJson());
            }
            JSONArray orderJson = new JSONArray();
            for (int position : order) {
                orderJson.put(position);
            }
            JSONObject json = new JSONObject().put("songs", songs).put("order", orderJson).put("cursor", cursor).put("position", positionMs()).put("shuffle", shuffle).put("repeat", repeat);
            File temporary = new File(queueFile().getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(temporary)) {
                out.write(json.toString().getBytes("UTF-8"));
            }
            if (!temporary.renameTo(queueFile())) {
                Log.w(TAG, "could not save the queue");
            }
        } catch (IOException | JSONException e) {
            Log.w(TAG, "could not save the queue", e);
        }
    }

    private void loadSavedQueue() {
        File file = queueFile();
        if (!file.isFile()) {
            return;
        }
        try (FileInputStream in = new FileInputStream(file)) {
            JSONObject json = new JSONObject(Http.readAll(in));
            queue.clear();
            queue.addAll(Media.songs(json.optJSONArray("songs")));
            JSONArray orderJson = json.optJSONArray("order");
            order = new int[orderJson == null ? 0 : orderJson.length()];
            for (int i = 0; i < order.length; i++) {
                order[i] = Math.max(0, Math.min(queue.size() - 1, orderJson.optInt(i)));
            }
            if (order.length != queue.size()) {
                buildOrder(0);
            }
            cursor = Math.max(0, Math.min(json.optInt("cursor"), order.length - 1));
            shuffle = json.optBoolean("shuffle");
            repeat = json.optInt("repeat", REPEAT_OFF);
            pendingSeekMs = Math.max(0, json.optInt("position"));
        } catch (IOException | JSONException e) {
            Log.w(TAG, "could not read the saved queue", e);
        }
    }
}
