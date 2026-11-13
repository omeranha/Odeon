package com.spotydrome.car;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Lets Odeon on the user's phone see and control what plays here. The state goes up on every change (and every
// 15 s while playing, for the position); commands come back over a long poll that the server holds for up to 25 s.
final class RemoteLink {

    private static final String TAG = "RemoteLink";
    private static final long PUSH_DELAY_MS = 400;
    private static final long HEARTBEAT_MS = 15_000;
    private static final long OFFLINE_RETRY_MS = 15_000;
    private static final long MAX_BACKOFF_MS = 60_000;

    private final PlayerService service;
    private final Api api;
    private final String deviceId;
    private final String deviceName;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pusher = Executors.newSingleThreadExecutor();
    private final Runnable push = this::push;
    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            if (service.isPlaying()) {
                push();
            }
            main.postDelayed(this, HEARTBEAT_MS);
        }
    };
    private volatile boolean running;
    private Thread poller;

    RemoteLink(PlayerService service) {
        this.service = service;
        api = new Api(service);
        Prefs prefs = new Prefs(service);
        deviceId = prefs.deviceId();
        deviceName = service.getString(R.string.device_name);
    }

    void start() {
        running = true;
        poller = new Thread(this::pollLoop, "remote-commands");
        poller.setDaemon(true);
        poller.start();
        main.post(push);
        main.postDelayed(heartbeat, HEARTBEAT_MS);
    }

    void stop() {
        running = false;
        main.removeCallbacks(push);
        main.removeCallbacks(heartbeat);
        if (poller != null) {
            poller.interrupt();
        }
        pusher.shutdownNow();
    }

    void stateChanged() {
        main.removeCallbacks(push);
        main.postDelayed(push, PUSH_DELAY_MS);
    }

    private void push() {
        if (!running || !service.online()) {
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("name", deviceName).put("kind", "car").put("state", service.remoteState());
        } catch (JSONException e) {
            return;
        }
        pusher.execute(() -> {
            try {
                api.putRemoteState(deviceId, body);
            } catch (IOException e) {
                Log.d(TAG, "state not sent: " + e.getMessage());
            }
        });
    }

    private void pollLoop() {
        long backoff = 2_000;
        while (running) {
            try {
                if (!service.online()) {
                    Thread.sleep(OFFLINE_RETRY_MS);
                    continue;
                }
                JSONArray commands = api.pollRemoteCommands(deviceId);
                backoff = 2_000;
                for (int i = 0; i < commands.length(); i++) {
                    JSONObject command = commands.optJSONObject(i);
                    if (command != null) {
                        main.post(() -> {
                            if (running) {
                                service.applyRemote(command);
                            }
                        });
                    }
                }
            } catch (InterruptedException e) {
                return;
            } catch (IOException e) {
                Log.d(TAG, "command poll failed: " + e.getMessage());
                try {
                    Thread.sleep(backoff);
                } catch (InterruptedException interrupted) {
                    return;
                }
                backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            }
        }
    }
}
