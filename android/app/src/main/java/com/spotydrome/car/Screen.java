package com.spotydrome.car;

import android.view.View;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

abstract class Screen {

    interface Work<T> {
        T run() throws Exception;
    }

    interface Done<T> {
        void accept(T result);
    }

    private static final ExecutorService background = Executors.newFixedThreadPool(3);

    final MainActivity activity;
    private View view;
    private boolean destroyed;

    Screen(MainActivity activity) {
        this.activity = activity;
    }

    abstract View create();

    final View view() {
        if (view == null) {
            view = create();
        }
        return view;
    }

    void onShow() {
    }

    void onHide() {
    }

    void onPlayerChanged() {
    }

    void onDestroy() {
        destroyed = true;
    }

    boolean isDestroyed() {
        return destroyed;
    }

    // Runs work off the main thread and hands the result back, unless the screen was closed meanwhile.
    final <T> void load(Work<T> work, Done<T> done, Done<Exception> failed) {
        background.execute(() -> {
            try {
                T result = work.run();
                activity.runOnUiThread(() -> {
                    if (!destroyed) {
                        done.accept(result);
                    }
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    if (e instanceof Api.AuthException) {
                        activity.signedOut(e.getMessage());
                    } else if (failed != null) {
                        failed.accept(e);
                    } else {
                        activity.toast(e.getMessage());
                    }
                });
            }
        });
    }
}
