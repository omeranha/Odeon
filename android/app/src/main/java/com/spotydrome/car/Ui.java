package com.spotydrome.car;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

final class Ui {

    static final int BACKGROUND = 0xFF000000;
    static final int SURFACE = 0xFF121212;
    static final int RAISED = 0xFF1E1E1E;
    static final int PRESSED = 0xFF2A2A2A;
    static final int TEXT = 0xFFF2F2F2;
    static final int SUBDUED = 0xFF9A9A9A;
    static final int ACCENT = 0xFF1ED760;
    static final int ON_ACCENT = 0xFF000000;

    private Ui() {
    }

    static int dp(Context context, float dp) {
        return Math.round(dp * context.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context context, float sp, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setSingleLine(true);
        view.setEllipsize(TextUtils.TruncateAt.END);
        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return view;
    }

    static Drawable pressable(int color, int pressedColor, float radius) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, rounded(pressedColor, radius));
        states.addState(new int[] {android.R.attr.state_selected}, rounded(pressedColor, radius));
        states.addState(new int[0], rounded(color, radius));
        return states;
    }

    static GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    static ImageButton iconButton(Context context, int icon, int sizeDp, int background, View.OnClickListener listener) {
        ImageButton button = new ImageButton(context);
        button.setImageResource(icon);
        button.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int padding = dp(context, sizeDp * 0.24f);
        button.setPadding(padding, padding, padding, padding);
        button.setBackground(pressable(background, background == ACCENT ? 0xFF3BE477 : PRESSED, dp(context, sizeDp / 2f)));
        if (background == ACCENT) {
            button.setColorFilter(ON_ACCENT);
        }
        button.setOnClickListener(listener);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(context, sizeDp), dp(context, sizeDp)));
        return button;
    }

    static TextView pill(Context context, String label, boolean primary, View.OnClickListener listener) {
        TextView pill = text(context, 18, primary ? ON_ACCENT : TEXT, true);
        pill.setText(label);
        pill.setGravity(Gravity.CENTER);
        int horizontal = dp(context, 24);
        pill.setPadding(horizontal, 0, horizontal, 0);
        pill.setMinHeight(dp(context, 56));
        pill.setBackground(pressable(primary ? ACCENT : RAISED, primary ? 0xFF3BE477 : PRESSED, dp(context, 28)));
        pill.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(context, 56));
        params.rightMargin = dp(context, 12);
        pill.setLayoutParams(params);
        return pill;
    }

    static void setToggle(ImageButton button, boolean active) {
        if (active) {
            button.setColorFilter(ACCENT);
        } else {
            button.clearColorFilter();
        }
    }

    static String time(int ms) {
        int seconds = Math.max(0, ms / 1000);
        return String.format(Locale.US, "%d:%02d", seconds / 60, seconds % 60);
    }

    static String size(long bytes) {
        if (bytes >= 1024L * 1024 * 1024) {
            return String.format(Locale.US, "%.1f GB", bytes / (1024f * 1024 * 1024));
        }
        return String.format(Locale.US, "%d MB", bytes / (1024 * 1024));
    }

    static int blendAlpha(int color, float alpha) {
        return Color.argb(Math.round(255 * alpha), Color.red(color), Color.green(color), Color.blue(color));
    }
}
