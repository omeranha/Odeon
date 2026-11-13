package com.spotydrome.car;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;

// Shows a short code and waits for someone signed in on their phone to approve it under Settings → Link a device.
public final class SignInActivity extends Activity {

    static final String EXTRA_MESSAGE = "message";

    private final Handler handler = new Handler();
    private TextView code;
    private TextView status;
    private Api.DeviceLink link;
    private boolean active;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setBackgroundColor(Ui.BACKGROUND);
        int padding = Ui.dp(this, 32);
        column.setPadding(padding, padding, padding, padding);

        TextView title = Ui.text(this, 30, Ui.TEXT, true);
        title.setText(R.string.sign_in_title);
        title.setGravity(Gravity.CENTER);
        column.addView(title);

        TextView steps = Ui.text(this, 19, Ui.SUBDUED, false);
        steps.setSingleLine(false);
        steps.setGravity(Gravity.CENTER);
        steps.setText(getString(R.string.sign_in_steps, Prefs.SERVER.replace("https://", "")));
        steps.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 16));
        column.addView(steps, new LinearLayout.LayoutParams(Ui.dp(this, 720), ViewGroup.LayoutParams.WRAP_CONTENT));

        code = Ui.text(this, 64, Ui.ACCENT, true);
        code.setGravity(Gravity.CENTER);
        code.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
        column.addView(code);

        status = Ui.text(this, 17, Ui.SUBDUED, false);
        status.setSingleLine(false);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 16));
        String message = getIntent().getStringExtra(EXTRA_MESSAGE);
        status.setText(message == null ? "" : message);
        column.addView(status, new LinearLayout.LayoutParams(Ui.dp(this, 720), ViewGroup.LayoutParams.WRAP_CONTENT));

        column.addView(Ui.pill(this, getString(R.string.new_code), false, v -> start()));
        setContentView(column);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Orientation.apply(this);
        active = true;
        if (link == null || link.expiresAt < System.currentTimeMillis()) {
            start();
        } else {
            schedulePoll();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        active = false;
        handler.removeCallbacksAndMessages(null);
    }

    private void start() {
        handler.removeCallbacksAndMessages(null);
        code.setText("····-····");
        status.setText(R.string.getting_code);
        new Thread(() -> {
            try {
                Api.DeviceLink fresh = new Api(this).startDeviceLink(getString(R.string.device_name));
                runOnUiThread(() -> {
                    link = fresh;
                    code.setText(fresh.userCode);
                    status.setText(R.string.waiting_for_approval);
                    schedulePoll();
                });
            } catch (IOException e) {
                runOnUiThread(() -> {
                    status.setText(getString(R.string.sign_in_failed, e.getMessage()));
                    handler.postDelayed(this::start, 10_000);
                });
            }
        }).start();
    }

    private void schedulePoll() {
        if (!active || link == null) {
            return;
        }
        handler.postDelayed(this::poll, link.intervalSeconds * 1000L);
    }

    private void poll() {
        Api.DeviceLink current = link;
        if (current == null) {
            return;
        }
        if (current.expiresAt < System.currentTimeMillis()) {
            start();
            return;
        }
        new Thread(() -> {
            try {
                boolean approved = new Api(this).pollDeviceLink(current.deviceCode);
                runOnUiThread(() -> {
                    if (approved) {
                        startActivity(new Intent(this, MainActivity.class));
                        finish();
                    } else {
                        schedulePoll();
                    }
                });
            } catch (Http.HttpException e) {
                runOnUiThread(e.status == 404 ? this::start : this::schedulePoll);
            } catch (IOException e) {
                runOnUiThread(() -> {
                    status.setText(getString(R.string.sign_in_failed, e.getMessage()));
                    schedulePoll();
                });
            }
        }).start();
    }
}
