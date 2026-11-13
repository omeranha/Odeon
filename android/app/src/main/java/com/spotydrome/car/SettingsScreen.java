package com.spotydrome.car;

import android.app.AlertDialog;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.io.File;

final class SettingsScreen extends Screen {

    private interface Toggle {
        void set(boolean value);
    }

    private interface Choice {
        void set(int value);
    }

    private Prefs prefs;

    SettingsScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        prefs = new Prefs(activity);
        ScrollView scroll = new ScrollView(activity);
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 20);
        column.setPadding(padding, padding, padding, padding);
        scroll.addView(column);

        TextView heading = Ui.text(activity, 28, Ui.TEXT, true);
        heading.setText(R.string.tab_settings);
        column.addView(heading);

        LinearLayout account = row(column, activity.getString(R.string.signed_in_as, prefs.displayName()), "@" + prefs.username() + " • " + Prefs.SERVER.replace("https://", ""));
        account.addView(Ui.pill(activity, activity.getString(R.string.sign_out), false, v -> confirmSignOut()));

        section(column, R.string.section_playback);
        bitrateRow(column, activity.getString(R.string.stream_quality), activity.getString(R.string.stream_quality_detail), prefs.streamBitrate(), prefs::setStreamBitrate);
        bitrateRow(column, activity.getString(R.string.download_quality), activity.getString(R.string.download_quality_detail), prefs.downloadBitrate(), prefs::setDownloadBitrate);
        toggleRow(column, activity.getString(R.string.offline_only), activity.getString(R.string.offline_only_detail), prefs.offlineOnly(), value -> {
            prefs.setOfflineOnly(value);
            activity.updateOfflineBanner(false);
        });

        section(column, R.string.section_car);
        toggleRow(column, activity.getString(R.string.flip_screen), activity.getString(R.string.flip_screen_detail), prefs.flipScreen(), value -> {
            prefs.setFlipScreen(value);
            Orientation.apply(activity);
        });
        toggleRow(column, activity.getString(R.string.pause_on_power_loss), activity.getString(R.string.pause_on_power_loss_detail), prefs.pauseOnPowerLoss(), prefs::setPauseOnPowerLoss);
        toggleRow(column, activity.getString(R.string.resume_on_power), activity.getString(R.string.resume_on_power_detail), prefs.resumeOnPower(), prefs::setResumeOnPower);

        section(column, R.string.section_storage);
        Library library = Library.get(activity);
        if (library.externalSdAvailable()) {
            toggleRow(column, activity.getString(R.string.use_sd_card), activity.getString(R.string.use_sd_card_detail), prefs.useExternalSd(), prefs::setUseExternalSd);
        }
        LinearLayout cache = row(column, activity.getString(R.string.cover_cache), activity.getString(R.string.cover_cache_detail));
        cache.addView(Ui.pill(activity, activity.getString(R.string.clear), false, v -> clearCovers()));

        TextView version = Ui.text(activity, 14, Ui.SUBDUED, false);
        version.setText(activity.getString(R.string.version, BuildConfig.VERSION_NAME));
        version.setPadding(0, Ui.dp(activity, 24), 0, 0);
        column.addView(version);
        return scroll;
    }

    private void section(LinearLayout column, int title) {
        TextView header = Ui.text(activity, 15, Ui.ACCENT, true);
        header.setText(title);
        header.setAllCaps(true);
        header.setPadding(0, Ui.dp(activity, 28), 0, Ui.dp(activity, 4));
        column.addView(header);
    }

    private LinearLayout row(LinearLayout column, String title, String detail) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(Ui.dp(activity, 76));
        LinearLayout texts = new LinearLayout(activity);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView name = Ui.text(activity, 19, Ui.TEXT, false);
        name.setText(title);
        TextView summary = Ui.text(activity, 15, Ui.SUBDUED, false);
        summary.setSingleLine(false);
        summary.setText(detail);
        texts.addView(name);
        texts.addView(summary);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        textParams.rightMargin = Ui.dp(activity, 16);
        row.addView(texts, textParams);
        column.addView(row);
        return row;
    }

    private void toggleRow(LinearLayout column, String title, String detail, boolean value, Toggle onChange) {
        LinearLayout row = row(column, title, detail);
        Switch toggle = new Switch(activity);
        toggle.setChecked(value);
        toggle.setOnCheckedChangeListener((button, checked) -> onChange.set(checked));
        row.addView(toggle);
        row.setOnClickListener(v -> toggle.toggle());
    }

    private void bitrateRow(LinearLayout column, String title, String detail, int value, Choice onChange) {
        LinearLayout row = row(column, title, detail);
        TextView pill = Ui.pill(activity, value + " kbps", false, null);
        pill.setOnClickListener(v -> {
            int current = Integer.parseInt(pill.getText().toString().replace(" kbps", ""));
            int next = Prefs.BITRATES[0];
            for (int i = 0; i < Prefs.BITRATES.length; i++) {
                if (Prefs.BITRATES[i] == current) {
                    next = Prefs.BITRATES[(i + 1) % Prefs.BITRATES.length];
                }
            }
            pill.setText(next + " kbps");
            onChange.set(next);
        });
        row.addView(pill);
    }

    @SuppressWarnings("deprecation")
    private void confirmSignOut() {
        new AlertDialog.Builder(activity, AlertDialog.THEME_HOLO_DARK)
                .setTitle(R.string.sign_out)
                .setMessage(R.string.sign_out_detail)
                .setPositiveButton(R.string.sign_out, (dialog, which) -> activity.signedOut(null))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void clearCovers() {
        Covers.get(activity).clearMemory();
        File[] files = new File(activity.getCacheDir(), "covers").listFiles();
        int removed = 0;
        if (files != null) {
            for (File file : files) {
                if (file.delete()) {
                    removed++;
                }
            }
        }
        activity.toast(activity.getString(R.string.cover_cache_cleared, removed));
    }
}
