package com.spotydrome.car;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity implements PlayerService.Listener {

    private static final int TAB_HOME = 0;
    private static final int TAB_SEARCH = 1;
    private static final int TAB_LIBRARY = 2;
    private static final int TAB_DOWNLOADS = 3;
    private static final int TAB_SETTINGS = 4;
    private static final int[] TAB_ICONS = {R.drawable.ic_home, R.drawable.ic_search, R.drawable.ic_library, R.drawable.ic_download, R.drawable.ic_settings};
    private static final int[] TAB_LABELS = {R.string.tab_home, R.string.tab_search, R.string.tab_library, R.string.tab_downloads, R.string.tab_settings};

    private final List<Screen> stack = new ArrayList<>();
    private final View[] tabs = new View[TAB_ICONS.length];
    private final BroadcastReceiver connectivity = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            updateOfflineBanner(true);
        }
    };

    private Prefs prefs;
    private int tab = -1;
    private FrameLayout content;
    private TextView offlineBanner;
    private View miniPlayer;
    private ImageView miniCover;
    private TextView miniTitle;
    private TextView miniArtist;
    private ImageButton miniPlay;
    private Toast toast;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        if (!prefs.signedIn()) {
            startActivity(new Intent(this, SignInActivity.class));
            finish();
            return;
        }
        startService(new Intent(this, PlayerService.class));
        setContentView(buildLayout());
        switchTab(TAB_HOME);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Orientation.apply(this);
        if (content == null) {
            return;
        }
        PlayerService.addListener(this);
        registerReceiver(connectivity, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
        updateOfflineBanner(false);
        onPlayerChanged();
        Screen top = top();
        if (top != null) {
            top.onShow();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (content == null) {
            return;
        }
        PlayerService.removeListener(this);
        unregisterReceiver(connectivity);
        Screen top = top();
        if (top != null) {
            top.onHide();
        }
    }

    @Override
    protected void onDestroy() {
        for (Screen screen : stack) {
            screen.onDestroy();
        }
        stack.clear();
        super.onDestroy();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_MODERATE) {
            Covers.get(this).clearMemory();
        }
    }

    @Override
    public void onBackPressed() {
        if (stack.size() > 1) {
            pop();
        } else if (tab != TAB_HOME) {
            switchTab(TAB_HOME);
        } else {
            moveTaskToBack(true);
        }
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setBackgroundColor(Ui.BACKGROUND);

        LinearLayout rail = new LinearLayout(this);
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setGravity(Gravity.CENTER_HORIZONTAL);
        rail.setBackgroundColor(Ui.SURFACE);
        rail.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
        for (int i = 0; i < TAB_ICONS.length; i++) {
            int index = i;
            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setBackground(Ui.pressable(Ui.SURFACE, Ui.PRESSED, Ui.dp(this, 14)));
            ImageView icon = new ImageView(this);
            icon.setImageResource(TAB_ICONS[i]);
            item.addView(icon, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
            TextView label = Ui.text(this, 13, Ui.SUBDUED, false);
            label.setText(TAB_LABELS[i]);
            label.setGravity(Gravity.CENTER);
            item.addView(label, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            item.setOnClickListener(v -> switchTab(index));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(Ui.dp(this, 104), 0, 1f);
            params.setMargins(Ui.dp(this, 8), Ui.dp(this, 4), Ui.dp(this, 8), Ui.dp(this, 4));
            rail.addView(item, params);
            tabs[i] = item;
        }
        root.addView(rail, new LinearLayout.LayoutParams(Ui.dp(this, 120), ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout main = new LinearLayout(this);
        main.setOrientation(LinearLayout.VERTICAL);
        offlineBanner = Ui.text(this, 15, Ui.ON_ACCENT, true);
        offlineBanner.setBackgroundColor(0xFFF5C451);
        offlineBanner.setGravity(Gravity.CENTER);
        offlineBanner.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
        offlineBanner.setText(R.string.offline_banner);
        main.addView(offlineBanner, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content = new FrameLayout(this);
        main.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        miniPlayer = buildMiniPlayer();
        main.addView(miniPlayer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 88)));
        root.addView(main, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        return root;
    }

    private View buildMiniPlayer() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Ui.RAISED);
        int padding = Ui.dp(this, 12);
        bar.setPadding(padding, 0, padding, 0);

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.HORIZONTAL);
        info.setGravity(Gravity.CENTER_VERTICAL);
        info.setOnClickListener(v -> openNowPlaying());
        miniCover = new ImageView(this);
        miniCover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        info.addView(miniCover, new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 64)));
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        miniTitle = Ui.text(this, 19, Ui.TEXT, true);
        miniArtist = Ui.text(this, 15, Ui.SUBDUED, false);
        texts.addView(miniTitle);
        texts.addView(miniArtist);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        textParams.leftMargin = Ui.dp(this, 14);
        info.addView(texts, textParams);
        bar.addView(info, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        bar.addView(Ui.iconButton(this, R.drawable.ic_skip_previous, 64, Ui.RAISED, v -> PlayerService.previous(this)));
        miniPlay = Ui.iconButton(this, R.drawable.ic_play, 72, Ui.ACCENT, v -> PlayerService.toggle(this));
        LinearLayout.LayoutParams playParams = (LinearLayout.LayoutParams) miniPlay.getLayoutParams();
        playParams.leftMargin = Ui.dp(this, 12);
        playParams.rightMargin = Ui.dp(this, 12);
        bar.addView(miniPlay);
        bar.addView(Ui.iconButton(this, R.drawable.ic_skip_next, 64, Ui.RAISED, v -> PlayerService.next(this)));
        return bar;
    }

    // ---- Navigation.

    void switchTab(int index) {
        for (Screen screen : stack) {
            screen.onHide();
            screen.onDestroy();
        }
        stack.clear();
        content.removeAllViews();
        tab = index;
        for (int i = 0; i < tabs.length; i++) {
            tabs[i].setSelected(i == index);
            ViewGroup item = (ViewGroup) tabs[i];
            ((ImageView) item.getChildAt(0)).setColorFilter(i == index ? Ui.ACCENT : Ui.SUBDUED);
            ((TextView) item.getChildAt(1)).setTextColor(i == index ? Ui.TEXT : Ui.SUBDUED);
        }
        switch (index) {
            case TAB_SEARCH:
                open(new SearchScreen(this));
                break;
            case TAB_LIBRARY:
                open(new LibraryScreen(this));
                break;
            case TAB_DOWNLOADS:
                open(new DownloadsScreen(this));
                break;
            case TAB_SETTINGS:
                open(new SettingsScreen(this));
                break;
            default:
                open(new HomeScreen(this));
                break;
        }
    }

    void open(Screen screen) {
        Screen previous = top();
        if (previous != null) {
            previous.onHide();
            content.removeView(previous.view());
        }
        stack.add(screen);
        content.addView(screen.view(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        screen.onShow();
        onPlayerChanged();
    }

    void openCollection(Media.Collection collection) {
        open(new DetailScreen(this, collection));
    }

    void openNowPlaying() {
        if (PlayerService.current() == null || PlayerService.current().song() == null) {
            return;
        }
        if (top() instanceof NowPlayingScreen) {
            return;
        }
        open(new NowPlayingScreen(this));
    }

    void pop() {
        Screen screen = stack.remove(stack.size() - 1);
        screen.onHide();
        content.removeView(screen.view());
        screen.onDestroy();
        Screen previous = top();
        if (previous != null) {
            content.addView(previous.view(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            previous.onShow();
        }
        onPlayerChanged();
    }

    private Screen top() {
        return stack.isEmpty() ? null : stack.get(stack.size() - 1);
    }

    // ---- Shared state.

    boolean isOnline() {
        if (prefs.offlineOnly()) {
            return false;
        }
        NetworkInfo network = ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).getActiveNetworkInfo();
        return network != null && network.isConnected();
    }

    void updateOfflineBanner(boolean refreshScreen) {
        boolean online = isOnline();
        boolean changed = (offlineBanner.getVisibility() == View.VISIBLE) == online;
        offlineBanner.setVisibility(online ? View.GONE : View.VISIBLE);
        Screen top = top();
        if (changed && refreshScreen && top != null) {
            top.onShow();
        }
    }

    void toast(String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        if (toast != null) {
            toast.cancel();
        }
        toast = Toast.makeText(this, message, Toast.LENGTH_LONG);
        toast.show();
    }

    void signedOut(String message) {
        prefs.clearSession();
        stopService(new Intent(this, PlayerService.class));
        startActivity(new Intent(this, SignInActivity.class).putExtra(SignInActivity.EXTRA_MESSAGE, message));
        finish();
    }

    @Override
    public void onPlayerChanged() {
        if (miniPlayer == null) {
            return;
        }
        PlayerService player = PlayerService.current();
        Media.Song song = player == null ? null : player.song();
        miniPlayer.setVisibility(song == null || top() instanceof NowPlayingScreen ? View.GONE : View.VISIBLE);
        if (song != null) {
            miniTitle.setText(song.title);
            miniArtist.setText(song.artist);
            miniPlay.setImageResource(player.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play);
            Covers.get(this).load(miniCover, song, Covers.SMALL, R.drawable.ic_music_note);
            toast(player.takeError());
        }
        for (Screen screen : stack) {
            screen.onPlayerChanged();
        }
    }
}
