/* ==========================================================================
   ZAI NOTES — script.js
   ---------------------------------------------------------------------
   This file is heavily commented because it's written as a learning
   resource. It is organized into clear sections:

     1. State & Constants
     2. LocalStorage helpers (load/save)
     3. Utility helpers (id, dates, escaping, debounce)
     4. Rendering (turning note data into HTML on the page)
     5. Note CRUD (create, read, update, delete)
     6. Modal / Editor logic (open, close, autosave)
     7. Search & Filters
     8. Theme toggle (dark/light)
     9. Toast notifications
    10. Keyboard shortcuts
    11. Misc UI wiring (sidebar, ripple effect, delete confirm)
    12. App initialization

   Everything runs after the HTML has loaded, using DOMContentLoaded.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {

  /* ------------------------------------------------------------------
     1. STATE & CONSTANTS
     "State" just means "the data our app is currently working with".
     We keep it all in one place so it's easy to reason about.
  ------------------------------------------------------------------ */

  const STORAGE_KEY = "zai-notes-data";   // key used in localStorage
  const THEME_KEY = "zai-notes-theme";    // key used in localStorage for theme

  // This object represents the "shape" of a single note. New notes are
  // created by copying this template and overwriting a few fields.
  // color: "blue" | "green" | "yellow" | "pink"
  function createEmptyNote() {
    const now = Date.now();
    return {
      id: generateId(),
      title: "",
      content: "",
      color: "blue",
      pinned: false,
      favorited: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  // App-wide state lives here. `notes` is the single source of truth —
  // every time it changes, we save it to localStorage and re-render.
  const state = {
    notes: [],              // array of note objects
    activeFilter: "all",    // "all" | "pinned" | "recent" | "favorites" | "archived"
    activeColorFilter: "all", // "all" | "blue" | "green" | "yellow" | "pink"
    searchTerm: "",
    editingNoteId: null,    // id of note currently open in the modal, or null for a new note
    pendingDeleteId: null,  // id of note waiting on the confirm-delete modal
  };

  /* ------------------------------------------------------------------
     Cache DOM elements once, up front. Querying the DOM is relatively
     slow, so grabbing references a single time (instead of re-querying
     inside every function) keeps things fast and code easy to read.
  ------------------------------------------------------------------ */
  const el = {
    notesGrid: document.getElementById("notesGrid"),
    emptyState: document.getElementById("emptyState"),
    emptyStateTitle: document.getElementById("emptyStateTitle"),
    emptyStateText: document.getElementById("emptyStateText"),
    emptyStateBtn: document.getElementById("emptyStateBtn"),
    pageTitle: document.getElementById("pageTitle"),

    searchInput: document.getElementById("searchInput"),
    filterBtns: document.querySelectorAll(".filter-btn"),
    labelChips: document.querySelectorAll(".label-chip"),

    countAll: document.getElementById("countAll"),
    countPinned: document.getElementById("countPinned"),
    countRecent: document.getElementById("countRecent"),
    countFavorites: document.getElementById("countFavorites"),
    countArchived: document.getElementById("countArchived"),

    newNoteBtn: document.getElementById("newNoteBtn"),
    newNoteBtnTop: document.getElementById("newNoteBtnTop"),

    // Sidebar (mobile)
    sidebar: document.getElementById("sidebar"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    menuBtn: document.getElementById("menuBtn"),
    sidebarClose: document.getElementById("sidebarClose"),

    // Theme
    themeToggle: document.getElementById("themeToggle"),

    // Modal (editor)
    modalOverlay: document.getElementById("modalOverlay"),
    noteModal: document.getElementById("noteModal"),
    noteTitleInput: document.getElementById("noteTitleInput"),
    noteContentInput: document.getElementById("noteContentInput"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    saveNoteBtn: document.getElementById("saveNoteBtn"),
    charCounter: document.getElementById("charCounter"),
    metaCreated: document.getElementById("metaCreated"),
    metaEdited: document.getElementById("metaEdited"),
    colorSwatches: document.querySelectorAll(".color-swatch"),
    pinToggleBtn: document.getElementById("pinToggleBtn"),
    favToggleBtn: document.getElementById("favToggleBtn"),
    duplicateBtn: document.getElementById("duplicateBtn"),
    copyBtn: document.getElementById("copyBtn"),
    archiveBtn: document.getElementById("archiveBtn"),
    deleteBtn: document.getElementById("deleteBtn"),

    // Confirm delete modal
    confirmOverlay: document.getElementById("confirmOverlay"),
    cancelDeleteBtn: document.getElementById("cancelDeleteBtn"),
    confirmDeleteBtn: document.getElementById("confirmDeleteBtn"),

    // Toasts
    toastContainer: document.getElementById("toastContainer"),
  };

  /* ------------------------------------------------------------------
     2. LOCAL STORAGE HELPERS
     localStorage can only store strings, so we use JSON.stringify to
     turn our array of note objects into a string when saving, and
     JSON.parse to turn it back into real objects when loading.
  ------------------------------------------------------------------ */

  function saveNotesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
    } catch (err) {
      // Storage might fail if it's full or blocked (private browsing, etc.)
      console.error("Could not save notes to localStorage:", err);
      showToast("Couldn't save — storage may be full.", "danger");
    }
  }

  function loadNotesFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Could not parse saved notes:", err);
      return [];
    }
  }

  /* ------------------------------------------------------------------
     3. UTILITY HELPERS
  ------------------------------------------------------------------ */

  // Generates a reasonably unique ID without needing any library.
  function generateId() {
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // Turns a timestamp into a friendly string like "Aug 6, 2026, 3:45 PM".
  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Turns a timestamp into a relative string like "2 hours ago", falling
  // back to a full date for anything older than a week.
  function formatRelativeTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHr = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHr / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return formatDateTime(timestamp);
  }

  // Prevents raw HTML in note titles/content from being interpreted as
  // markup (a basic but important defense against XSS when injecting
  // user-typed text with innerHTML).
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Debounce: returns a version of `fn` that only runs after `delay` ms
  // have passed without it being called again. Used for auto-save so we
  // don't write to localStorage on every single keystroke.
  function debounce(fn, delay) {
    let timerId;
    return function debounced(...args) {
      clearTimeout(timerId);
      timerId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /* ------------------------------------------------------------------
     4. RENDERING
     These functions read from `state` and update the DOM. We never
     manually edit the DOM outside of render functions — instead we
     change `state.notes` (or filters/search), then call render().
     This "single source of truth" pattern is a core idea in modern
     front-end development (it's the same idea frameworks like React
     are built around, just done by hand here).
  ------------------------------------------------------------------ */

  // Returns the notes that should currently be visible, after applying
  // the active filter, color filter and search term.
  function getVisibleNotes() {
    let list = [...state.notes];

    // --- Filter tabs ---
    if (state.activeFilter === "pinned") {
      list = list.filter((n) => n.pinned && !n.archived);
    } else if (state.activeFilter === "recent") {
      // "Recent" = edited in the last 3 days, not archived.
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      list = list.filter((n) => n.updatedAt >= threeDaysAgo && !n.archived);
    } else if (state.activeFilter === "favorites") {
      list = list.filter((n) => n.favorited && !n.archived);
    } else if (state.activeFilter === "archived") {
      list = list.filter((n) => n.archived);
    } else {
      // "all" — everything except archived notes (archive = tucked away)
      list = list.filter((n) => !n.archived);
    }

    // --- Color label filter ---
    if (state.activeColorFilter !== "all") {
      list = list.filter((n) => n.color === state.activeColorFilter);
    }

    // --- Search (matches title or content, case-insensitive) ---
    if (state.searchTerm.trim() !== "") {
      const term = state.searchTerm.trim().toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(term) ||
          n.content.toLowerCase().includes(term)
      );
    }

    // --- Sort: pinned notes first, then most recently updated ---
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    return list;
  }

  // Builds the HTML for a single note card. Returns a string of HTML
  // which we join together and insert in one go (faster than inserting
  // one card at a time).
  function noteCardTemplate(note) {
    const colorVarMap = {
      blue: "#2563EB",
      green: "#22C55E",
      yellow: "#FACC15",
      pink: "#EC4899",
    };
    const accent = colorVarMap[note.color] || colorVarMap.blue;
    const title = note.title.trim() || "Untitled note";
    const snippet = escapeHtml(note.content);

    return `
      <article
        class="note-card${note.favorited ? " favorited" : ""}${note.archived ? " is-archived" : ""}"
        style="--card-accent:${accent}"
        data-id="${note.id}"
        tabindex="0"
        role="button"
        aria-label="Open note: ${escapeHtml(title)}"
      >
        <div class="note-card-header">
          <h3 class="note-card-title">${escapeHtml(title)}</h3>
          ${note.pinned ? `
          <span class="note-card-pin-badge" title="Pinned" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l1.6 5.1L19 8l-4 3.6L16 17l-4-2.6L8 17l1-5.4-4-3.6 5.4-.9L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </span>` : ""}
        </div>
        <p class="note-card-body">${snippet}</p>
        <div class="note-card-footer">
          <span class="note-card-date">${formatRelativeTime(note.updatedAt)}</span>
          <div class="note-card-actions">
            <button class="icon-btn action-fav" data-action="favorite" data-id="${note.id}" aria-label="${note.favorited ? "Remove from favorites" : "Add to favorites"}" title="Favorite">
              <svg class="note-card-fav-icon" width="15" height="15" viewBox="0 0 24 24" fill="${note.favorited ? "currentColor" : "none"}"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.1 2.3 4.5 6 4c2-.3 3.8.6 6 3 2.2-2.4 4-3.3 6-3 3.7.5 5.6 4.1 4 7.7C19.5 16.4 12 21 12 21z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn action-pin" data-action="pin" data-id="${note.id}" aria-label="${note.pinned ? "Unpin note" : "Pin note"}" title="Pin">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${note.pinned ? "currentColor" : "none"}"><path d="M12 2l1.6 5.1L19 8l-4 3.6L16 17l-4-2.6L8 17l1-5.4-4-3.6 5.4-.9L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn action-delete" data-action="delete" data-id="${note.id}" aria-label="Delete note" title="Delete">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  // Main render function: redraws the notes grid, empty state, filter
  // counts, and page title. Call this any time state changes.
  function render() {
    const visible = getVisibleNotes();

    // --- Grid / empty state ---
    if (visible.length === 0) {
      el.notesGrid.innerHTML = "";
      el.emptyState.hidden = false;
      updateEmptyStateMessage();
    } else {
      el.emptyState.hidden = true;
      el.notesGrid.innerHTML = visible.map(noteCardTemplate).join("");
    }

    // --- Sidebar counts ---
    const nonArchived = state.notes.filter((n) => !n.archived);
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    el.countAll.textContent = nonArchived.length;
    el.countPinned.textContent = nonArchived.filter((n) => n.pinned).length;
    el.countRecent.textContent = nonArchived.filter((n) => n.updatedAt >= threeDaysAgo).length;
    el.countFavorites.textContent = nonArchived.filter((n) => n.favorited).length;
    el.countArchived.textContent = state.notes.filter((n) => n.archived).length;

    // --- Page title reflects the active filter ---
    const titles = {
      all: "All Notes",
      pinned: "Pinned Notes",
      recent: "Recent Notes",
      favorites: "Favorite Notes",
      archived: "Archived Notes",
    };
    el.pageTitle.textContent = titles[state.activeFilter] || "All Notes";
  }

  function updateEmptyStateMessage() {
    if (state.searchTerm.trim() !== "") {
      el.emptyStateTitle.textContent = "No matching notes";
      el.emptyStateText.textContent = `Nothing matches "${state.searchTerm}". Try a different search.`;
      el.emptyStateBtn.hidden = true;
    } else if (state.activeFilter === "archived") {
      el.emptyStateTitle.textContent = "Nothing archived";
      el.emptyStateText.textContent = "Notes you archive will be tucked away here.";
      el.emptyStateBtn.hidden = true;
    } else if (state.activeFilter === "pinned") {
      el.emptyStateTitle.textContent = "No pinned notes";
      el.emptyStateText.textContent = "Pin a note to keep it at the top of your list.";
      el.emptyStateBtn.hidden = true;
    } else if (state.activeFilter === "favorites") {
      el.emptyStateTitle.textContent = "No favorites yet";
      el.emptyStateText.textContent = "Mark notes as favorites to find them quickly.";
      el.emptyStateBtn.hidden = true;
    } else {
      el.emptyStateTitle.textContent = "No notes here yet";
      el.emptyStateText.textContent = "Start capturing your ideas — create your first note and it'll show up here.";
      el.emptyStateBtn.hidden = false;
    }
  }

  /* ------------------------------------------------------------------
     5. NOTE CRUD (Create, Read, Update, Delete)
  ------------------------------------------------------------------ */

  function addNote(note) {
    state.notes.unshift(note); // newest notes appear first
    saveNotesToStorage();
    render();
  }

  function findNoteById(id) {
    return state.notes.find((n) => n.id === id);
  }

  function updateNote(id, changes) {
    const note = findNoteById(id);
    if (!note) return;
    Object.assign(note, changes, { updatedAt: Date.now() });
    saveNotesToStorage();
    render();
  }

  function deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    saveNotesToStorage();
    render();
  }

  function duplicateNote(id) {
    const original = findNoteById(id);
    if (!original) return;
    const copy = {
      ...original,
      id: generateId(),
      title: original.title ? `${original.title} (copy)` : "",
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.notes.unshift(copy);
    saveNotesToStorage();
    render();
    showToast("Note duplicated", "success");
  }

  /* ------------------------------------------------------------------
     6. MODAL / EDITOR LOGIC
     The same modal is reused for both "create" and "edit". We track
     which note is being edited via state.editingNoteId — if it's null,
     we're creating a brand-new note.
  ------------------------------------------------------------------ */

  function openModalForNewNote() {
    state.editingNoteId = null;
    el.noteTitleInput.value = "";
    el.noteContentInput.value = "";
    setActiveColorSwatch("blue");
    setPinButtonState(false);
    setFavButtonState(false);
    updateCharCounter();
    el.metaCreated.textContent = "Created just now";
    el.metaEdited.textContent = "Not edited";
    showModal();
    // Focus the title field so the user can start typing immediately.
    setTimeout(() => el.noteTitleInput.focus(), 50);
  }

  function openModalForNote(id) {
    const note = findNoteById(id);
    if (!note) return;
    state.editingNoteId = id;
    el.noteTitleInput.value = note.title;
    el.noteContentInput.value = note.content;
    setActiveColorSwatch(note.color);
    setPinButtonState(note.pinned);
    setFavButtonState(note.favorited);
    updateCharCounter();
    el.metaCreated.textContent = `Created ${formatDateTime(note.createdAt)}`;
    el.metaEdited.textContent =
      note.updatedAt !== note.createdAt
        ? `Edited ${formatRelativeTime(note.updatedAt)}`
        : "Not edited";
    showModal();
    setTimeout(() => el.noteTitleInput.focus(), 50);
  }

  function showModal() {
    el.modalOverlay.hidden = false;
  }

  function closeModal() {
    // Auto-save any unsaved changes before closing, so users never lose work.
    persistModalToNote();
    el.modalOverlay.hidden = true;
    state.editingNoteId = null;
  }

  // Reads the current color swatch selection from the DOM.
  function getSelectedColor() {
    const active = document.querySelector(".color-swatch.active");
    return active ? active.dataset.color : "blue";
  }

  function setActiveColorSwatch(color) {
    el.colorSwatches.forEach((swatch) => {
      const isMatch = swatch.dataset.color === color;
      swatch.classList.toggle("active", isMatch);
      swatch.setAttribute("aria-pressed", String(isMatch));
    });
  }

  function setPinButtonState(isPinned) {
    el.pinToggleBtn.setAttribute("aria-pressed", String(isPinned));
  }
  function setFavButtonState(isFav) {
    el.favToggleBtn.setAttribute("aria-pressed", String(isFav));
  }

  function updateCharCounter() {
    const count = el.noteContentInput.value.length;
    el.charCounter.textContent = `${count} character${count === 1 ? "" : "s"}`;
  }

  // Gathers the current modal field values into a plain object.
  function readModalFields() {
    return {
      title: el.noteTitleInput.value.trim(),
      content: el.noteContentInput.value,
      color: getSelectedColor(),
      pinned: el.pinToggleBtn.getAttribute("aria-pressed") === "true",
      favorited: el.favToggleBtn.getAttribute("aria-pressed") === "true",
    };
  }

  // Saves whatever is currently in the modal, creating a new note if
  // necessary. Used both by the explicit "Save" button and by
  // auto-save / close-modal so behavior stays consistent.
  function persistModalToNote() {
    const fields = readModalFields();
    // Don't save a completely empty, brand-new note (nothing to keep).
    const isBlankNewNote =
      state.editingNoteId === null && fields.title === "" && fields.content.trim() === "";
    if (isBlankNewNote) return;

    if (state.editingNoteId === null) {
      // Creating a new note for the first time this modal session.
      const note = createEmptyNote();
      Object.assign(note, fields);
      state.notes.unshift(note);
      state.editingNoteId = note.id; // further autosaves update this note
      saveNotesToStorage();
      render();
    } else {
      updateNote(state.editingNoteId, fields);
    }
  }

  // Debounced auto-save: fires 600ms after the user stops typing.
  const autoSave = debounce(() => {
    persistModalToNote();
  }, 600);

  /* ------------------------------------------------------------------
     7. SEARCH & FILTERS
  ------------------------------------------------------------------ */

  function handleSearchInput(e) {
    state.searchTerm = e.target.value;
    render();
  }

  function handleFilterClick(e) {
    const btn = e.currentTarget;
    state.activeFilter = btn.dataset.filter;
    el.filterBtns.forEach((b) => {
      const isActive = b === btn;
      b.classList.toggle("active", isActive);
      if (isActive) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    render();
    closeSidebarOnMobile();
  }

  function handleColorChipClick(e) {
    const chip = e.currentTarget;
    state.activeColorFilter = chip.dataset.color;
    el.labelChips.forEach((c) => c.classList.toggle("active", c === chip));
    render();
  }

  /* ------------------------------------------------------------------
     8. THEME TOGGLE (Dark / Light mode)
  ------------------------------------------------------------------ */

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function loadInitialTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      applyTheme(saved);
      return;
    }
    // No saved preference — respect the user's OS-level preference.
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  /* ------------------------------------------------------------------
     9. TOAST NOTIFICATIONS
     Small, temporary messages that confirm an action happened
     ("Note deleted", "Note pinned", etc). They auto-dismiss.
  ------------------------------------------------------------------ */

  const toastIcons = {
    success: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    info: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    danger: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  };

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.innerHTML = `
      <span class="toast-icon">${toastIcons[type] || toastIcons.info}</span>
      <span>${escapeHtml(message)}</span>
    `;
    el.toastContainer.appendChild(toast);

    // Remove the toast automatically after a few seconds.
    setTimeout(() => {
      toast.classList.add("leaving");
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
    }, 2600);
  }

  /* ------------------------------------------------------------------
     10. KEYBOARD SHORTCUTS
        Ctrl/Cmd + N -> New note
        Ctrl/Cmd + S -> Save current note
        Delete       -> Delete the note currently open in the modal
        Esc          -> Close whichever modal is open
  ------------------------------------------------------------------ */

  function handleGlobalKeydown(e) {
    const isModalOpen = !el.modalOverlay.hidden;
    const isConfirmOpen = !el.confirmOverlay.hidden;
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd + N — new note (prevent the browser's own "new window" shortcut)
    if (ctrlOrCmd && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openModalForNewNote();
      return;
    }

    // Ctrl/Cmd + S — save current note without closing the modal
    if (ctrlOrCmd && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (isModalOpen) {
        persistModalToNote();
        showToast("Note saved", "success");
      }
      return;
    }

    // Escape — close whichever modal is open, in priority order
    if (e.key === "Escape") {
      if (isConfirmOpen) {
        hideConfirmModal();
      } else if (isModalOpen) {
        closeModal();
      }
      return;
    }

    // Delete — only when the modal is open and focus isn't in a text field,
    // to avoid hijacking normal text editing (deleting characters).
    if (e.key === "Delete" && isModalOpen) {
      const activeTag = document.activeElement.tagName;
      if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
        e.preventDefault();
        requestDeleteNote(state.editingNoteId);
      }
    }
  }

  /* ------------------------------------------------------------------
     11. MISC UI WIRING
  ------------------------------------------------------------------ */

  // ---- Mobile sidebar open/close ----
  function openSidebar() {
    el.sidebar.classList.add("open");
    el.sidebarOverlay.classList.add("visible");
    el.menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.sidebarOverlay.classList.remove("visible");
    el.menuBtn.setAttribute("aria-expanded", "false");
  }
  function closeSidebarOnMobile() {
    if (window.innerWidth <= 820) closeSidebar();
  }

  // ---- Ripple click effect for .ripple buttons ----
  function attachRippleEffect(button) {
    button.addEventListener("click", (e) => {
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement("span");
      const size = Math.max(rect.width, rect.height);
      ripple.className = "ripple-effect";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      button.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  }

  // ---- Delete confirmation modal ----
  function requestDeleteNote(id) {
    if (!id) return;
    state.pendingDeleteId = id;
    el.confirmOverlay.hidden = false;
  }
  function hideConfirmModal() {
    el.confirmOverlay.hidden = true;
    state.pendingDeleteId = null;
  }
  function confirmDelete() {
    if (state.pendingDeleteId) {
      const wasOpenInEditor = state.editingNoteId === state.pendingDeleteId;
      deleteNote(state.pendingDeleteId);
      showToast("Note deleted", "danger");
      if (wasOpenInEditor) {
        el.modalOverlay.hidden = true;
        state.editingNoteId = null;
      }
    }
    hideConfirmModal();
  }

  // ---- Clicks inside the notes grid (event delegation) ----
  // Instead of adding a click listener to every single note card (which
  // would be wasteful and need re-binding on every render), we add ONE
  // listener to the grid container and figure out what was clicked.
  function handleGridClick(e) {
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      // An action icon (favorite/pin/delete) was clicked — handle it and
      // stop the click from also opening the note (event bubbling).
      e.stopPropagation();
      const { action, id } = actionBtn.dataset;
      const note = findNoteById(id);
      if (!note) return;

      if (action === "favorite") {
        updateNote(id, { favorited: !note.favorited });
        showToast(note.favorited ? "Removed from favorites" : "Added to favorites", "success");
      } else if (action === "pin") {
        updateNote(id, { pinned: !note.pinned });
        showToast(note.pinned ? "Note unpinned" : "Note pinned", "success");
      } else if (action === "delete") {
        requestDeleteNote(id);
      }
      return;
    }

    // Otherwise, if a note card itself was clicked, open it for editing.
    const card = e.target.closest(".note-card");
    if (card) {
      openModalForNote(card.dataset.id);
    }
  }

  // Allow opening a note card with the keyboard (Enter/Space), since
  // cards are focusable via tabindex="0" for accessibility.
  function handleGridKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".note-card");
    if (card) {
      e.preventDefault();
      openModalForNote(card.dataset.id);
    }
  }

  /* ------------------------------------------------------------------
     12. APP INITIALIZATION
     Wire up every event listener and do the first render.
  ------------------------------------------------------------------ */

  function init() {
    // Load saved data.
    state.notes = loadNotesFromStorage();
    loadInitialTheme();

    // First paint.
    render();

    // --- New note buttons ---
    el.newNoteBtn.addEventListener("click", openModalForNewNote);
    el.newNoteBtnTop.addEventListener("click", openModalForNewNote);
    el.emptyStateBtn.addEventListener("click", openModalForNewNote);

    // --- Search ---
    el.searchInput.addEventListener("input", handleSearchInput);

    // --- Filters & label chips ---
    el.filterBtns.forEach((btn) => btn.addEventListener("click", handleFilterClick));
    el.labelChips.forEach((chip) => chip.addEventListener("click", handleColorChipClick));

    // --- Notes grid (event delegation for all card interactions) ---
    el.notesGrid.addEventListener("click", handleGridClick);
    el.notesGrid.addEventListener("keydown", handleGridKeydown);

    // --- Modal editor controls ---
    el.closeModalBtn.addEventListener("click", closeModal);
    el.saveNoteBtn.addEventListener("click", () => {
      persistModalToNote();
      showToast("Note saved", "success");
      closeModal();
    });
    // Clicking the dark overlay outside the modal closes it, same as Esc.
    el.modalOverlay.addEventListener("click", (e) => {
      if (e.target === el.modalOverlay) closeModal();
    });

    // Auto-save while typing (title or content).
    el.noteTitleInput.addEventListener("input", autoSave);
    el.noteContentInput.addEventListener("input", () => {
      updateCharCounter();
      autoSave();
    });

    // Color label swatches.
    el.colorSwatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        setActiveColorSwatch(swatch.dataset.color);
        autoSave();
      });
    });

    // Pin / favorite toggle inside modal.
    el.pinToggleBtn.addEventListener("click", () => {
      const next = el.pinToggleBtn.getAttribute("aria-pressed") !== "true";
      setPinButtonState(next);
      autoSave();
    });
    el.favToggleBtn.addEventListener("click", () => {
      const next = el.favToggleBtn.getAttribute("aria-pressed") !== "true";
      setFavButtonState(next);
      autoSave();
    });

    // Duplicate / copy / archive / delete inside modal.
    el.duplicateBtn.addEventListener("click", () => {
      if (state.editingNoteId) {
        duplicateNote(state.editingNoteId);
      } else {
        showToast("Save the note first to duplicate it", "info");
      }
    });
    el.copyBtn.addEventListener("click", async () => {
      const text = `${el.noteTitleInput.value}\n\n${el.noteContentInput.value}`.trim();
      try {
        await navigator.clipboard.writeText(text);
        showToast("Note copied to clipboard", "success");
      } catch (err) {
        showToast("Couldn't copy — try selecting the text manually", "danger");
      }
    });
    el.archiveBtn.addEventListener("click", () => {
      if (!state.editingNoteId) {
        showToast("Save the note first to archive it", "info");
        return;
      }
      const note = findNoteById(state.editingNoteId);
      updateNote(state.editingNoteId, { archived: !note.archived });
      showToast(note.archived ? "Note unarchived" : "Note archived", "success");
      closeModal();
    });
    el.deleteBtn.addEventListener("click", () => requestDeleteNote(state.editingNoteId));

    // --- Confirm delete modal ---
    el.cancelDeleteBtn.addEventListener("click", hideConfirmModal);
    el.confirmDeleteBtn.addEventListener("click", confirmDelete);
    el.confirmOverlay.addEventListener("click", (e) => {
      if (e.target === el.confirmOverlay) hideConfirmModal();
    });

    // --- Theme toggle ---
    el.themeToggle.addEventListener("click", toggleTheme);

    // --- Mobile sidebar ---
    el.menuBtn.addEventListener("click", openSidebar);
    el.sidebarClose.addEventListener("click", closeSidebar);
    el.sidebarOverlay.addEventListener("click", closeSidebar);

    // --- Ripple effect on all buttons with the .ripple class ---
    document.querySelectorAll(".ripple").forEach(attachRippleEffect);

    // --- Global keyboard shortcuts ---
    document.addEventListener("keydown", handleGlobalKeydown);
  }

  init();
});
