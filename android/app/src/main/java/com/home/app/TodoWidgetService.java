package com.home.app;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

public class TodoWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TodoRemoteViewsFactory(this.getApplicationContext(), intent);
    }
}

class TodoRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {
    private Context context;
    private String[] todos = {"???..."};
    
    TodoRemoteViewsFactory(Context context, Intent intent) {
        this.context = context;
    }
    
    @Override public void onCreate() {}
    @Override public void onDataSetChanged() {
        // In a real app, fetch from shared preferences or database
        // For now, show placeholder
        todos = new String[]{"??App????"};
    }
    @Override public void onDestroy() {}
    @Override public int getCount() { return todos.length; }
    @Override public RemoteViews getViewAt(int position) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.todo_widget_list_item);
        views.setTextViewText(R.id.widgetItemTitle, todos[position]);
        return views;
    }
    @Override public RemoteViews getLoadingView() { return null; }
    @Override public int getViewTypeCount() { return 1; }
    @Override public long getItemId(int position) { return position; }
    @Override public boolean hasStableIds() { return true; }
}