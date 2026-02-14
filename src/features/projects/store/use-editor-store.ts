import { create } from 'zustand';

import { Id } from '../../../../convex/_generated/dataModel';
import { Tabs } from '@radix-ui/react-tabs';
import { set } from 'date-fns';

interface TabState {
  openTabs: Id<"files">[];
  activeTabId: Id<"files"> | null;
  previewTabId: Id<"files"> | null;
};

const defaultTabState: TabState = {
  openTabs: [],
  activeTabId: null,
  previewTabId: null,
};

interface EditorStore {
  tabs: Map<Id<"projects">, TabState>;
  getTabState: (projectId: Id<"projects">) => TabState;
  openFile: (
    projectId: Id<"projects">,
    fileId: Id<"files">,
    options: { pinned: boolean }
  ) => void;
  closeTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  closeAllTabs: (projectId: Id<"projects">) => void;
  setActiveTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
};

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: new Map(),

  getTabState: (projectId) => {
    return get().tabs.get(projectId) ?? defaultTabState;
  },

  openFile: (projectId, fileId, { pinned }) => {
    const tabs = new Map(get().tabs);
    const state = tabs.get(projectId) ?? defaultTabState;
    const { openTabs, previewTabId } = state;
    const isOpen = openTabs.includes(fileId);

    // Case 1: Opening as preview - replace existing preview or add new
    if (!isOpen ) {
      const newTabs = previewTabId
       ? openTabs.map((id) => (id === previewTabId) ? fileId : id))
       : [...openTabs, fileId]

       tabs.set(projectId,{
        openTabs: newTabs,
        activeTabId: fileId,
        previewTabId: fileId,
       });
       set({ tabs });
       return;
    }

    
  }
}))