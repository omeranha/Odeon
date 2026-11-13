package com.spotydrome.car;

import android.content.Context;
import android.os.Handler;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// Searches the library and, when online, YouTube Music through Downtify for songs that aren't in the library yet.
final class SearchScreen extends Screen {

    private static final long DEBOUNCE_MS = 600;

    private final Handler handler = new Handler();
    private final Runnable search = this::search;
    private EditText input;
    private LinearLayout header;
    private ResultsAdapter results;
    private int generation;

    SearchScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, padding, padding, 0);

        LinearLayout box = new LinearLayout(activity);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setBackground(Ui.rounded(Ui.RAISED, Ui.dp(activity, 28)));
        box.setPadding(Ui.dp(activity, 18), 0, Ui.dp(activity, 18), 0);
        ImageView icon = new ImageView(activity);
        icon.setImageResource(R.drawable.ic_search);
        icon.setColorFilter(Ui.SUBDUED);
        box.addView(icon, new LinearLayout.LayoutParams(Ui.dp(activity, 28), Ui.dp(activity, 28)));
        input = new EditText(activity);
        input.setHint(R.string.search_hint);
        input.setHintTextColor(Ui.SUBDUED);
        input.setTextColor(Ui.TEXT);
        input.setTextSize(20);
        input.setSingleLine(true);
        input.setBackground(null);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                handler.removeCallbacks(search);
                handler.postDelayed(search, DEBOUNCE_MS);
            }
        });
        input.setOnEditorActionListener((v, actionId, event) -> {
            handler.removeCallbacks(search);
            search();
            hideKeyboard();
            return true;
        });
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        inputParams.leftMargin = Ui.dp(activity, 10);
        box.addView(input, inputParams);
        column.addView(box, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 60)));

        ListView list = new ListView(activity);
        list.setDivider(null);
        list.setSelector(android.R.color.transparent);
        header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.VERTICAL);
        list.addHeaderView(header, null, false);
        results = new ResultsAdapter(activity);
        list.setAdapter(results);
        list.setOnItemClickListener((parent, view, position, id) -> results.play(position - list.getHeaderViewsCount()));
        list.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(AbsListView view, int scrollState) {
                if (scrollState != SCROLL_STATE_IDLE) {
                    hideKeyboard();
                }
            }

            @Override
            public void onScroll(AbsListView view, int firstVisibleItem, int visibleItemCount, int totalItemCount) {
            }
        });
        column.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return column;
    }

    @Override
    void onShow() {
        if (input.getText().length() == 0) {
            input.requestFocus();
            handler.postDelayed(() -> ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(input, 0), 200);
        }
    }

    @Override
    void onHide() {
        hideKeyboard();
    }

    @Override
    void onPlayerChanged() {
        results.notifyDataSetChanged();
    }

    @Override
    void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void hideKeyboard() {
        ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
    }

    private void search() {
        String query = input.getText().toString().trim();
        int current = ++generation;
        header.removeAllViews();
        results.set(new ArrayList<>(), new ArrayList<>(), false);
        if (query.isEmpty()) {
            return;
        }
        if (!activity.isOnline()) {
            List<Media.Song> matches = searchDownloaded(query);
            results.set(matches, new ArrayList<>(), false);
            if (matches.isEmpty()) {
                header.addView(Views.message(activity, activity.getString(R.string.no_offline_results)));
            }
            return;
        }
        Api api = new Api(activity);
        results.setCatalogLoading(query.length() >= 2);
        load(() -> api.search(query), result -> {
            if (current != generation) {
                return;
            }
            header.removeAllViews();
            if (!result.artists.isEmpty()) {
                header.addView(Views.shelf(activity, activity.getString(R.string.artists), result.artists, activity::openCollection));
            }
            if (!result.albums.isEmpty()) {
                header.addView(Views.shelf(activity, activity.getString(R.string.albums), result.albums, activity::openCollection));
            }
            results.setLibrary(result.songs);
        }, null);
        if (query.length() < 2) {
            return;
        }
        load(() -> api.catalogSearch(query), catalog -> {
            if (current == generation) {
                results.setCatalog(catalog);
            }
        }, error -> {
            if (current == generation) {
                results.setCatalog(new ArrayList<>());
            }
        });
    }

    private List<Media.Song> searchDownloaded(String query) {
        String needle = query.toLowerCase(Locale.ROOT);
        List<Media.Song> matches = new ArrayList<>();
        for (Media.Song song : Library.get(activity).downloadedSongs()) {
            if ((song.title + " " + song.artist + " " + song.album).toLowerCase(Locale.ROOT).contains(needle)) {
                matches.add(song);
            }
        }
        return matches;
    }

    private void addToLibrary(Media.Song song) {
        Api api = new Api(activity);
        activity.toast(activity.getString(R.string.adding_to_library, song.title));
        load(() -> {
            api.addToLibrary(song);
            return true;
        }, done -> activity.toast(activity.getString(R.string.added_to_library, song.title)), error -> activity.toast(activity.getString(R.string.add_failed, error.getMessage())));
    }

    // Library songs, then a "From YouTube Music" header, then songs that aren't in the library yet.
    private final class ResultsAdapter extends BaseAdapter {
        private final Context context;
        private final List<Media.Song> library = new ArrayList<>();
        private final List<Media.Song> catalog = new ArrayList<>();
        private boolean catalogLoading;

        ResultsAdapter(Context context) {
            this.context = context;
        }

        void set(List<Media.Song> librarySongs, List<Media.Song> catalogSongs, boolean loading) {
            library.clear();
            library.addAll(librarySongs);
            catalog.clear();
            catalog.addAll(catalogSongs);
            catalogLoading = loading;
            notifyDataSetChanged();
        }

        void setLibrary(List<Media.Song> songs) {
            library.clear();
            library.addAll(songs);
            dropDuplicates();
            notifyDataSetChanged();
        }

        void setCatalog(List<Media.Song> songs) {
            catalog.clear();
            catalog.addAll(songs);
            catalogLoading = false;
            dropDuplicates();
            notifyDataSetChanged();
        }

        void setCatalogLoading(boolean loading) {
            catalogLoading = loading;
            notifyDataSetChanged();
        }

        private void dropDuplicates() {
            Set<String> inLibrary = new HashSet<>();
            for (Media.Song song : library) {
                inLibrary.add(song.key());
            }
            List<Media.Song> fresh = new ArrayList<>();
            for (Media.Song song : catalog) {
                if (!inLibrary.contains(song.key())) {
                    fresh.add(song);
                }
            }
            catalog.clear();
            catalog.addAll(fresh);
        }

        private boolean hasCatalogSection() {
            return catalogLoading || !catalog.isEmpty();
        }

        @Override
        public int getCount() {
            return library.size() + (hasCatalogSection() ? 1 + catalog.size() : 0);
        }

        @Override
        public Object getItem(int position) {
            if (position < library.size()) {
                return library.get(position);
            }
            int offset = position - library.size() - 1;
            return offset < 0 ? null : catalog.get(offset);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public int getViewTypeCount() {
            return 2;
        }

        @Override
        public int getItemViewType(int position) {
            return position == library.size() ? 1 : 0;
        }

        @Override
        public boolean isEnabled(int position) {
            return getItemViewType(position) == 0;
        }

        void play(int position) {
            if (position < 0 || position >= getCount() || getItemViewType(position) != 0) {
                return;
            }
            Media.Song song = (Media.Song) getItem(position);
            if (activity.isOnline()) {
                PlayerService.playWithSuggestions(activity, song);
            } else {
                PlayerService.playQueue(activity, library, position);
            }
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            if (getItemViewType(position) == 1) {
                TextView title = convertView instanceof TextView ? (TextView) convertView : Views.sectionHeader(context, "");
                title.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                title.setText(catalogLoading ? context.getString(R.string.from_youtube_loading) : context.getString(R.string.from_youtube));
                return title;
            }
            Views.SongRow row = convertView == null ? new Views.SongRow(context, true) : (Views.SongRow) convertView.getTag();
            Media.Song song = (Media.Song) getItem(position);
            row.bind(context, song, position, SearchScreen.this::addToLibrary);
            return row.root;
        }
    }
}
