/**
 * DB Wrapper for IndexedDB
 */
class NoteDB {
    constructor(dbName = 'geeknote-db', version = 3) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('notes')) {
                    const store = db.createObjectStore('notes', { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                // V2: Images Store
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'id' });
                }
                // V3: Folders Store
                if (!db.objectStoreNames.contains('folders')) {
                    db.createObjectStore('folders', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this);
            };

            request.onerror = (event) => {
                console.error('DB Open Error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // Note Operations
    async addNote(note) {
        return this._perform('notes', 'readwrite', store => store.add(note));
    }

    async getNotes() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notes'], 'readonly');
            const store = transaction.objectStore('notes');
            const index = store.index('updatedAt');
            const request = index.openCursor(null, 'prev');
            const notes = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    notes.push(cursor.value);
                    cursor.continue();
                } else resolve(notes);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async updateNote(note) {
        return this._perform('notes', 'readwrite', store => store.put(note));
    }

    async getNote(id) {
        return this._perform('notes', 'readonly', store => store.get(id));
    }

    async deleteNote(id) {
        return this._perform('notes', 'readwrite', store => store.delete(id));
    }

    // Image Operations
    // Image Operations
    async saveImage(blob, customId = null) {
        const id = customId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
        await this._perform('images', 'readwrite', store => store.add({ id, blob }));
        return id;
    }

    async getImage(id) {
        return this._perform('images', 'readonly', store => store.get(id));
    }

    // Folder Operations (V3)
    async addFolder(folder) {
        return this._perform('folders', 'readwrite', store => store.add(folder));
    }

    async getFolders() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['folders'], 'readonly');
            const store = transaction.objectStore('folders');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async updateFolder(folder) {
        return this._perform('folders', 'readwrite', store => store.put(folder));
    }

    async deleteFolder(id) {
        return this._perform('folders', 'readwrite', store => store.delete(id));
    }

    // Helper
    async _perform(storeName, mode, action) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);
            const request = action(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

/**
 * Application Logic
 */
/**
 * Application Logic
 */
class App {
    constructor() {
        this.db = new NoteDB();
        this.currentNoteId = null;
        this.debounceTimer = null;
        this.selectedNoteIds = new Set();

        // Sorting State
        this.currentSort = 'updatedAt';

        // DOM Elements
        this.noteListEl = document.getElementById('note-list');
        this.btnNewNote = document.getElementById('btn-new-note');
        this.searchInput = document.getElementById('search-input');

        this.editorContainer = document.getElementById('editor-container');
        this.editorMain = document.querySelector('.editor'); // Actual scrollable container
        this.emptyState = document.getElementById('empty-state');
        this.titleInput = document.getElementById('note-title');
        this.tagsContainer = document.getElementById('tags-container');
        this.tagsList = document.getElementById('tags-list');
        this.addTagBtn = document.getElementById('add-tag-btn');
        this.contentInput = document.getElementById('note-content');
        this.toolbar = document.getElementById('toolbar');
        this.titleToolbar = document.getElementById('title-toolbar');
        this.imageToolbar = document.getElementById('image-toolbar');
        this.toast = document.getElementById('toast');

        // Initialize Image Toolbar Logic
        if (this.imageToolbar) this.initImageToolbar();

        // Toolbar Color Elements
        this.btnColorText = document.getElementById('btn-color-text');
        this.btnColorFill = document.getElementById('btn-color-fill');
        this.popupColorText = document.getElementById('popup-color-text');
        this.popupColorFill = document.getElementById('popup-color-fill');

        this.popupColorText = document.getElementById('popup-color-text');
        this.popupColorFill = document.getElementById('popup-color-fill');

        // New Controls
        this.sortSelect = document.getElementById('sort-select');

        // Initialize Image Resizer
        this.initResizer();
        this.btnBatchDelete = document.getElementById('btn-batch-delete');
        this.btnThemeToggle = document.getElementById('btn-theme-toggle');
        this.btnSortOrder = document.getElementById('btn-sort-order');
        this.sortAscending = false; // default: descending (newest first)

        // Import/Export/Folder Controls
        this.btnExport = document.getElementById('btn-export');
        this.btnImport = document.getElementById('btn-import');
        this.fileImport = document.getElementById('file-import');
        this.btnNewFolder = document.getElementById('btn-new-folder');

        // Modal Elements
        this.modalOverlay = document.getElementById('modal-overlay');
        this.modalMessage = document.getElementById('modal-message');
        this.modalInput = document.getElementById('modal-input');
        this.modalConfirmBtn = document.getElementById('modal-confirm');
        this.modalCancelBtn = document.getElementById('modal-cancel');

        this.officeColors = [
            '#000000', '#545454', '#a6a6a6', '#ffffff',
            '#ff0000', '#ff9900', '#ffff00', '#00ff00',
            '#0000ff', '#9900ff', '#ff00ff', '#00ffff',
            '#980000', '#e06666', '#3c78d8', '#76a5af'
        ];
        // Note: Auto-save uses class method debouncedSave() which calls saveCurrentNote()

        // 图片撤销栈 - 存储删除的图片信息用于 Ctrl+Z 恢复
        this.imageUndoStack = [];
    }

    /**
     * Debounce utility to prevent frequent function calls
     * @param {Function} func Function to debounce
     * @param {number} wait Delay in ms
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async init() {
        console.log('App initializing...');
        try {
            await this.db.open();
            console.log('DB Opened');

            this.initTheme();
            this.initColorPalettes();
            this.bindEvents();

            console.log('Events Bound');

            // Load persist state
            const lastNoteId = localStorage.getItem('geeknote_last_note_id');
            await this.renderNoteList();

            if (lastNoteId) {
                const noteExists = await this.db.getNote(parseInt(lastNoteId));
                if (noteExists) {
                    await this.loadNote(parseInt(lastNoteId));
                }
            }
        } catch (e) {
            console.error('App Init Fatal Error:', e);
            alert('应用初始化失败，请检查控制台日志: ' + e.message); // Init error - keep native as modal not ready
        }
    }

    initTheme() {
        const theme = localStorage.getItem('geeknote_theme') || 'dark';
        if (theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
        }
    }

    initColorPalettes() {
        if (!this.popupColorText || !this.popupColorFill) {
            console.error('Color palette DOM elements missing!');
            return;
        }

        const createGrid = (type, container) => {
            const grid = document.createElement('div');
            grid.className = 'color-grid';
            this.officeColors.forEach(color => {
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = color;

                // Use mousedown to prevent focus loss from editor
                swatch.onmousedown = (e) => {
                    e.preventDefault(); // Critical: stops editor from blurring
                    e.stopPropagation();
                    const cmd = type === 'text' ? 'foreColor' : 'hiliteColor';

                    // Add error handling provided by execCommand return value (though inconsistent across browsers)
                    const success = document.execCommand(cmd, false, color);
                    if (!success) {
                        // If standard command fails or no selection, try applying to container? 
                        // Actually, prompts usually handle 'no selection' by applying to next char.
                        // We will trust browser behavior but logging is useful.
                        console.warn('execCommand returned false');
                    }
                    container.classList.remove('visible');
                };

                grid.appendChild(swatch);
            });
            container.appendChild(grid);
        };
        createGrid('text', this.popupColorText);
        createGrid('fill', this.popupColorFill);
    }

    toggleTheme() {
        const current = document.body.getAttribute('data-theme');
        if (current === 'light') {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('geeknote_theme', 'dark');
        } else {
            document.body.setAttribute('data-theme', 'light');
            localStorage.setItem('geeknote_theme', 'light');
        }
    }

    bindEvents() {
        if (this.btnNewNote) {
            this.btnNewNote.addEventListener('click', () => {
                console.log('New Note Clicked');
                this.createNewNote();
            });
        } else {
            console.error('btnNewNote not found!');
        }

        if (this.btnThemeToggle) {
            this.btnThemeToggle.addEventListener('click', () => this.toggleTheme());
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.renderNoteList(e.target.value);
                if (this.currentNoteId) {
                    this.highlightEditor(this.currentNoteId, e.target.value);
                }
            });

            // Easter Egg Trigger: _@author + Enter
            this.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.searchInput.value.trim() === '_@author') {
                    e.preventDefault();
                    this.searchInput.value = '';
                    this.renderNoteList(''); // Restore note list
                    this.showEasterEgg();
                }
            });
        }

        if (this.sortSelect) {
            this.sortSelect.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.renderNoteList(this.searchInput.value);
            });
        }

        if (this.btnBatchDelete) {
            this.btnBatchDelete.addEventListener('click', async () => {
                if (this.selectedNoteIds.size > 0 && await this.showConfirm(`确定删除选中的 ${this.selectedNoteIds.size} 篇笔记吗？`)) {
                    for (let id of this.selectedNoteIds) {
                        await this.db.deleteNote(id);
                        if (this.currentNoteId === id) {
                            this.currentNoteId = null;
                            this.editorContainer.classList.add('hidden');
                            this.emptyState.classList.remove('hidden');
                            localStorage.removeItem('geeknote_last_note_id');
                        }
                    }
                    this.selectedNoteIds.clear();
                    this.updateBatchActions();
                    this.renderNoteList(this.searchInput.value);
                }
            });
        }

        // Import/Export/Folder Event Bindings
        if (this.btnExport) {
            this.btnExport.addEventListener('click', () => this.exportData());
        }
        if (this.btnImport) {
            this.btnImport.addEventListener('click', () => this.fileImport.click());
        }
        if (this.fileImport) {
            this.fileImport.addEventListener('change', (e) => this.importData(e));
        }
        if (this.btnNewFolder) {
            this.btnNewFolder.addEventListener('click', () => this.createNewFolder());
        }

        // Sort Order Toggle
        if (this.btnSortOrder) {
            this.btnSortOrder.addEventListener('click', () => {
                this.sortAscending = !this.sortAscending;
                this.btnSortOrder.textContent = this.sortAscending ? '↑' : '↓';
                this.btnSortOrder.title = this.sortAscending ? '升序 (点击切换)' : '倒序 (点击切换)';
                this.renderNoteList(this.searchInput.value);
            });
        }

        const autoSave = () => this.debouncedSave();
        this.titleInput.addEventListener('input', autoSave);
        this.tagsList.addEventListener('click', (e) => {
            if (e.target.closest('.tag-remove')) {
                const chip = e.target.closest('.tag-chip');
                this.removeTag(chip.dataset.tag);
            }
        });
        this.addTagBtn.addEventListener('click', () => this.requestAddTag());
        this.contentInput.addEventListener('input', autoSave);

        // Tab Indentation Support
        this.contentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertHTML', false, '&emsp;&emsp;');
            }
        });

        // Selection Change for Toolbar Visibility
        document.addEventListener('selectionchange', () => {
            // 如果有选中的图片，不显示文字工具栏
            const selectedImg = this.contentInput.querySelector('img.selected');
            if (selectedImg) {
                this.toolbar.classList.remove('visible');
                return;
            }

            const selection = window.getSelection();
            if (selection.rangeCount > 0 && !selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const commonAncestor = range.commonAncestorContainer;

                // 检查选中的是否是图片
                if (commonAncestor.nodeType === Node.ELEMENT_NODE && commonAncestor.tagName === 'IMG') {
                    this.toolbar.classList.remove('visible');
                    return;
                }

                // Check if selection is inside editor container
                if (this.editorContainer.contains(commonAncestor)) {
                    this.toolbar.classList.add('visible');
                    return;
                }
            }
            this.toolbar.classList.remove('visible');
        });

        // Color Picker Events (Toggle Popup)
        const togglePopup = (popup, e) => {
            e.stopPropagation();
            // Close others
            this.popupColorText.classList.remove('visible');
            this.popupColorFill.classList.remove('visible');
            popup.classList.toggle('visible');
        };

        if (this.btnColorText) this.btnColorText.addEventListener('click', (e) => togglePopup(this.popupColorText, e));
        if (this.btnColorFill) this.btnColorFill.addEventListener('click', (e) => togglePopup(this.popupColorFill, e));

        // Close popups on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.color-popup') && !e.target.closest('button[id^="btn-color"]')) {
                this.popupColorText.classList.remove('visible');
                this.popupColorFill.classList.remove('visible');
            }
        });

        // Image Paste
        this.contentInput.addEventListener('paste', (e) => this.handlePaste(e));

        // Image Drag & Drop (external files only)
        this.contentInput.addEventListener('dragover', (e) => {
            // Check if dragging files from outside
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                this.contentInput.classList.add('drag-over');
            }
            // Otherwise, allow native contenteditable drag behavior
        });

        this.contentInput.addEventListener('dragleave', (e) => {
            this.contentInput.classList.remove('drag-over');
        });

        this.contentInput.addEventListener('drop', async (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            // Only intercept if FILES are being dropped (external)
            if (files && files.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                this.contentInput.classList.remove('drag-over');

                for (let i = 0; i < files.length; i++) {
                    let file = files[i];
                    if (file.type.startsWith('image/')) {
                        // 压缩大图片
                        file = await this.compressImage(file);
                        const imageId = await this.db.saveImage(file);
                        this.insertImage(imageId, file);
                    }
                }
            } else {
                // Internal drag-and-drop (moving content)
                // Let browser handle it, but allow drop effect
                this.contentInput.classList.remove('drag-over');
                // Trigger save after a short delay to capture the new position
                setTimeout(() => this.debouncedSave(), 100);
            }
        });

        // Image Interaction - Click to select
        this.contentInput.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this.contentInput.querySelectorAll('img').forEach(img => img.classList.remove('selected'));
                e.target.classList.add('selected');
                // Firefox 兼容：直接隐藏文字工具栏
                this.toolbar.classList.remove('visible');
                // 清除文字选区
                window.getSelection().removeAllRanges();

                // 显示图片工具栏 (图片上方正中间，固定定位)
                if (this.imageToolbar) {
                    const rect = e.target.getBoundingClientRect();
                    const toolbarWidth = 200; // 工具栏宽度
                    const gap = 10; // 距离图片的间距
                    // 计算水平居中位置: 图片左边 + (图片宽度 - 工具栏宽度) / 2
                    const centerX = rect.left + (rect.width - toolbarWidth) / 2;
                    // 工具栏在图片上方，减去工具栏高度和间距
                    const topY = rect.top - gap;

                    this.imageToolbar.style.left = `${Math.max(10, centerX)}px`;
                    this.imageToolbar.style.top = `${topY}px`;
                    this.imageToolbar.style.transform = 'translateY(-100%)'; // 向上偏移自身高度
                    this.imageToolbar.classList.remove('hidden');
                    this.imageToolbar.classList.add('visible');
                }
            } else {
                if (e.target === this.contentInput) {
                    this.contentInput.querySelectorAll('img').forEach(img => img.classList.remove('selected'));
                    // 隐藏图片工具栏
                    if (this.imageToolbar) {
                        this.imageToolbar.classList.remove('visible');
                        this.imageToolbar.classList.add('hidden');
                    }
                }
            }
        });

        // Image Edge Resize - 边缘拖拽调整大小
        let resizingImage = null;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let resizeDir = ''; // 'right', 'bottom', or 'both'

        this.contentInput.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'IMG') {
                const img = e.target;
                const rect = img.getBoundingClientRect();
                const edgeThreshold = 15; // 边缘检测阈值 (px)

                // 检测是否点击在右边缘或右下角
                const isRightEdge = e.clientX > rect.right - edgeThreshold;
                const isBottomEdge = e.clientY > rect.bottom - edgeThreshold;

                if (isRightEdge || isBottomEdge) {
                    e.preventDefault();
                    resizingImage = img;
                    startX = e.clientX;
                    startY = e.clientY;
                    startWidth = img.offsetWidth;
                    startHeight = img.offsetHeight;

                    if (isRightEdge && isBottomEdge) {
                        resizeDir = 'both';
                        img.style.cursor = 'se-resize';
                        document.body.style.cursor = 'se-resize';
                    } else if (isRightEdge) {
                        resizeDir = 'right';
                        img.style.cursor = 'e-resize';
                        document.body.style.cursor = 'e-resize';
                    } else {
                        resizeDir = 'bottom';
                        img.style.cursor = 's-resize';
                        document.body.style.cursor = 's-resize';
                    }
                }
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (resizingImage) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                let newWidth = startWidth;

                if (resizeDir === 'right') {
                    newWidth = startWidth + dx;
                } else if (resizeDir === 'bottom') {
                    // 等比例计算宽度
                    const newHeight = startHeight + dy;
                    newWidth = startWidth * (newHeight / startHeight);
                } else {
                    // both (右下角斜向双向箭头)
                    const scaleX = (startWidth + dx) / startWidth;
                    const scaleY = (startHeight + dy) / startHeight;
                    // 取鼠标移动变化幅度更大的一条轴来进行等比缩放
                    const targetScale = Math.abs(dx) > Math.abs(dy) ? scaleX : scaleY;
                    newWidth = startWidth * targetScale;
                }

                newWidth = Math.max(50, newWidth); // 最小 50px
                resizingImage.style.width = `${newWidth}px`;
                resizingImage.style.maxWidth = `${newWidth}px`;
                resizingImage.style.minWidth = `${newWidth}px`; // 强制放大超过原生尺寸
                resizingImage.setAttribute('width', newWidth); // 同时设置 HTML 属性
                resizingImage.style.height = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            if (resizingImage) {
                resizingImage.style.cursor = 'pointer';
                document.body.style.cursor = '';
                resizingImage = null;
                // 调整完成后立即保存
                this.saveCurrentNote();
            }
        });

        // Custom Image Drag-and-Drop (within editor)
        let draggedImage = null;

        this.contentInput.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'IMG') {
                draggedImage = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', e.target.outerHTML);
            }
        });

        this.contentInput.addEventListener('dragend', (e) => {
            if (e.target.tagName === 'IMG') {
                e.target.classList.remove('dragging');
                draggedImage = null;
            }
        });

        // Handle internal image drop
        this.contentInput.addEventListener('drop', (e) => {
            if (draggedImage && e.target !== draggedImage) {
                e.preventDefault();
                e.stopPropagation();

                // Get drop position
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (range) {
                    // Clone the image
                    const imgClone = draggedImage.cloneNode(true);
                    imgClone.classList.remove('dragging', 'selected');

                    // Insert at drop position
                    range.insertNode(imgClone);

                    // Remove original
                    draggedImage.remove();
                    draggedImage = null;

                    // 使用 debouncedSave 保留 Undo 能力
                    this.debouncedSave();
                }
            }
        }, true); // Use capture phase to handle before the other drop handler



        this.contentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                const selected = this.contentInput.querySelector('img.selected');
                if (selected) {
                    e.preventDefault();

                    // 保存到撤销栈（记录位置信息）
                    const nextSibling = selected.nextSibling;
                    const parentNode = selected.parentNode;
                    this.imageUndoStack.push({
                        type: 'delete',
                        element: selected.cloneNode(true),
                        nextSibling: nextSibling,
                        parentNode: parentNode,
                        timestamp: Date.now()
                    });

                    // 限制撤销栈大小
                    if (this.imageUndoStack.length > 20) {
                        this.imageUndoStack.shift();
                    }

                    // 直接删除（无残留框）
                    selected.remove();

                    // 隐藏图片工具栏
                    if (this.imageToolbar) {
                        this.imageToolbar.classList.remove('visible');
                        this.imageToolbar.classList.add('hidden');
                    }

                    this.debouncedSave();
                }
            }
        });
        // === Image Layout Buttons (Toggle + Undo) ===
        const layoutBtns = document.querySelectorAll('.layout-btn');
        layoutBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const selectedImg = this.contentInput.querySelector('img.selected');
                if (!selectedImg) return;

                const mode = btn.dataset.mode;
                const currentMode = selectedImg.dataset.layoutMode || 'inline';

                // Toggle: 如果点击同一布局，恢复默认
                if (currentMode === mode) {
                    // 恢复默认布局
                    selectedImg.style.float = '';
                    selectedImg.style.display = '';
                    selectedImg.style.margin = '';
                    delete selectedImg.dataset.layoutMode;
                    btn.classList.remove('active');
                } else {
                    // 应用新布局
                    selectedImg.style.float = '';
                    selectedImg.style.display = '';
                    selectedImg.style.margin = '';

                    switch (mode) {
                        case 'left':
                            selectedImg.style.float = 'left';
                            selectedImg.style.margin = '0 15px 15px 0';
                            break;
                        case 'right':
                            selectedImg.style.float = 'right';
                            selectedImg.style.margin = '0 0 15px 15px';
                            break;
                        case 'center':
                            selectedImg.style.display = 'block';
                            selectedImg.style.margin = '15px auto';
                            break;
                        // 'inline' is default - no special styling
                    }

                    selectedImg.dataset.layoutMode = mode;

                    // 更新按钮状态
                    layoutBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }

                // 使用 debouncedSave 保留 Undo 能力
                this.debouncedSave();
            });
        });

        // 图片工具栏关闭按钮
        const closeImgToolbar = document.getElementById('btn-close-img-toolbar');
        if (closeImgToolbar) {
            closeImgToolbar.addEventListener('click', () => {
                this.imageToolbar.classList.remove('visible');
                this.imageToolbar.classList.add('hidden');
            });
        }

        // 剪切按钮
        const cutBtn = document.getElementById('btn-img-cut');
        if (cutBtn) {
            cutBtn.addEventListener('click', async () => {
                const selectedImg = this.contentInput.querySelector('img.selected');
                if (selectedImg) {
                    // 复制到剪贴板
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = selectedImg.naturalWidth || selectedImg.width;
                        canvas.height = selectedImg.naturalHeight || selectedImg.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(selectedImg, 0, 0);
                        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                        if (blob) {
                            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                        }
                    } catch (e) { /* ignore */ }
                    // 删除图片
                    selectedImg.remove();
                    this.imageToolbar.classList.remove('visible');
                    this.imageToolbar.classList.add('hidden');
                    this.debouncedSave();
                    this.showToast('已剪切');
                }
            });
        }

        // Ctrl+S
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveCurrentNote(true);
            }
        });

        // Ctrl+Z - 自定义图片撤销
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                // 检查撤销栈是否有图片操作
                if (this.imageUndoStack.length > 0) {
                    const lastAction = this.imageUndoStack[this.imageUndoStack.length - 1];
                    // 只处理最近 5 秒内的图片删除操作
                    if (lastAction.type === 'delete' && Date.now() - lastAction.timestamp < 5000) {
                        e.preventDefault();
                        e.stopPropagation();

                        const action = this.imageUndoStack.pop();
                        const restoredImg = action.element;

                        // 恢复到原位置
                        if (action.parentNode && document.contains(action.parentNode)) {
                            if (action.nextSibling && document.contains(action.nextSibling)) {
                                action.parentNode.insertBefore(restoredImg, action.nextSibling);
                            } else {
                                action.parentNode.appendChild(restoredImg);
                            }
                        } else {
                            // 父节点不存在，插入到编辑器末尾
                            this.contentInput.appendChild(restoredImg);
                        }

                        this.debouncedSave();
                        return;
                    }
                }
                // 如果不是图片操作，让浏览器默认处理
            }
        });

        // Ctrl+C - Copy selected image (Firefox 兼容)
        document.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                const selectedImg = this.contentInput.querySelector('img.selected');
                if (selectedImg) {
                    e.preventDefault();
                    try {
                        // 使用 Canvas 转换为 PNG Blob，兼容所有浏览器
                        const canvas = document.createElement('canvas');
                        canvas.width = selectedImg.naturalWidth || selectedImg.width;
                        canvas.height = selectedImg.naturalHeight || selectedImg.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(selectedImg, 0, 0);

                        const blob = await new Promise(resolve =>
                            canvas.toBlob(resolve, 'image/png')
                        );

                        if (blob) {
                            await navigator.clipboard.write([
                                new ClipboardItem({ 'image/png': blob })
                            ]);
                            this.showToast('图片已复制');
                        }
                    } catch (err) {
                        console.error('复制图片失败:', err);
                        // 降级方案：复制为 HTML
                        try {
                            const html = `<img src="${selectedImg.src}">`;
                            await navigator.clipboard.writeText(html);
                            this.showToast('已复制为HTML');
                        } catch (e2) {
                            this.showToast('复制失败');
                        }
                    }
                }
            }
        });

        // Scroll Persistence (localStorage for permanence)
        this.editorMain.addEventListener('scroll', () => {
            if (this.currentNoteId) {
                localStorage.setItem(`geeknote_scroll_${this.currentNoteId}`, this.editorMain.scrollTop);
            }
        });

        // Sidebar scroll persistence
        this.noteListEl = document.getElementById('note-list'); // Ensure reference
        this.noteListEl.addEventListener('scroll', () => {
            localStorage.setItem('geeknote_sidebar_scroll', this.noteListEl.scrollTop);
        });

        // Restore sidebar scroll on list render (handled in renderNoteList or separate init?)
        // Let's add a restore check here for initial load?
        // But renderNoteList clears HTML, so persistence logic needs to be re-applied or applied after render.
        // We will add logic to renderNoteList to restore scroll.

        // Toolbar Actions
        const btns = this.toolbar.querySelectorAll('button[data-cmd]');
        btns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.dataset.cmd;
                const val = btn.dataset.val || null;
                document.execCommand(cmd, false, val);
                this.debouncedSave();
            });
        });

        // === FLOATING TOOLBAR ===
        // Helper: show toolbar at position
        const showToolbarAtPosition = (x, y) => {
            const toolbarWidth = 420;
            const toolbarHeight = 40;

            let left = x - toolbarWidth / 2;
            let top = y - toolbarHeight - 10;

            // Keep in viewport
            if (left < 10) left = 10;
            if (left + toolbarWidth > window.innerWidth - 10) left = window.innerWidth - toolbarWidth - 10;
            if (top < 60) top = y + 20; // Show below if no space above

            this.toolbar.style.left = `${left}px`;
            this.toolbar.style.top = `${top}px`;
            this.toolbar.classList.remove('hidden');
            this.toolbar.classList.add('visible');
        };

        // Show toolbar on mouseup (after selection complete)
        this.contentInput.addEventListener('mouseup', (e) => {
            setTimeout(() => {
                const selection = window.getSelection();
                // Check if selection has content and either anchor or focus is in contentInput
                if (!selection.isCollapsed && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);

                    // Check if the range intersects with contentInput (more robust than strict containment)
                    if (this.contentInput.contains(range.commonAncestorContainer) ||
                        range.commonAncestorContainer === this.contentInput ||
                        range.intersectsNode(this.contentInput)) {

                        let rect = range.getBoundingClientRect();

                        // Fallback 1: getClientRects
                        if (rect.width === 0 && rect.height === 0) {
                            const rects = range.getClientRects();
                            if (rects.length > 0) rect = rects[0];
                        }

                        // Fallback 2: Handle Element-based selection (e.g. backward to start of block)
                        // If startContainer is Element, range points to child index
                        if ((rect.width === 0 || rect.height === 0) && range.startContainer.nodeType === 1) {
                            const child = range.startContainer.childNodes[range.startOffset];
                            if (child) {
                                if (child.nodeType === 3) { // Text node
                                    const tempRange = document.createRange();
                                    tempRange.selectNode(child);
                                    rect = tempRange.getBoundingClientRect();
                                } else if (child.getBoundingClientRect) {
                                    rect = child.getBoundingClientRect();
                                }
                            }
                        }

                        if (rect.width > 0 || rect.height > 0) {
                            showToolbarAtPosition(rect.left + rect.width / 2, rect.top);
                        }
                    }
                }
            }, 0); // 0ms delay to handle event ordering
        });

        // Hide toolbar when clicking elsewhere or selection collapsed
        document.addEventListener('mousedown', (e) => {
            if (!this.toolbar.contains(e.target)) {
                this.toolbar.classList.remove('visible');
                this.toolbar.classList.add('hidden');
            }
        });

        // === RIGHT-CLICK: Show toolbar on empty space, copy if text selected ===
        this.contentInput.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            const selection = window.getSelection();

            if (!selection.isCollapsed && selection.toString().trim()) {
                // Text selected: copy and show toast
                try {
                    await navigator.clipboard.writeText(selection.toString());
                    this.showToast('已复制到剪贴板');
                } catch (err) {
                    document.execCommand('copy');
                    this.showToast('已复制');
                }
            } else {
                // No selection: show toolbar at click position
                showToolbarAtPosition(e.clientX, e.clientY);
            }
        });

        // === IMAGE INSERT BUTTON ===
        const btnInsertImage = document.getElementById('btn-insert-image');
        const fileImageInsert = document.getElementById('file-image-insert');

        if (btnInsertImage && fileImageInsert) {
            btnInsertImage.addEventListener('click', () => {
                fileImageInsert.click();
            });

            fileImageInsert.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file && file.type.startsWith('image/')) {
                    const imageId = await this.db.saveImage(file);
                    this.insertImage(imageId, file);
                    this.debouncedSave();
                }
                fileImageInsert.value = ''; // Reset for next use
            });
        }

        // === TITLE TOOLBAR ===
        if (this.titleToolbar) {
            // Show title toolbar on title selection
            this.titleInput.addEventListener('mouseup', (e) => {
                setTimeout(() => {
                    const selection = window.getSelection();
                    if (!selection.isCollapsed && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        if (this.titleInput.contains(range.commonAncestorContainer)) {
                            const rect = range.getBoundingClientRect();
                            if (rect.width > 0) {
                                const toolbarWidth = 300;
                                let left = rect.left + rect.width / 2 - toolbarWidth / 2;
                                let top = rect.bottom + 10;

                                if (left < 10) left = 10;
                                if (left + toolbarWidth > window.innerWidth - 10) left = window.innerWidth - toolbarWidth - 10;

                                this.titleToolbar.style.left = `${left}px`;
                                this.titleToolbar.style.top = `${top}px`;
                                this.titleToolbar.classList.remove('hidden');
                                this.titleToolbar.classList.add('visible');
                            }
                        }
                    } else {
                        // Hide if no selection in title
                        this.titleToolbar.classList.remove('visible');
                        this.titleToolbar.classList.add('hidden');
                    }
                }, 10);
            });

            // Title toolbar button clicks
            this.titleToolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const cmd = btn.dataset.cmd;
                    document.execCommand(cmd, false, null);
                    this.debouncedSave();
                });
            });

            // Title toolbar color buttons
            const btnTitleColorText = document.getElementById('btn-title-color-text');
            const popupTitleColorText = document.getElementById('popup-title-color-text');
            const btnTitleColorFill = document.getElementById('btn-title-color-fill');
            const popupTitleColorFill = document.getElementById('popup-title-color-fill');

            if (btnTitleColorText && popupTitleColorText) {
                this.buildColorPalette(popupTitleColorText, 'foreColor');
                btnTitleColorText.addEventListener('click', (e) => {
                    e.stopPropagation();
                    popupTitleColorText.classList.toggle('visible');
                    if (popupTitleColorFill) popupTitleColorFill.classList.remove('visible');
                });
            }

            if (btnTitleColorFill && popupTitleColorFill) {
                this.buildColorPalette(popupTitleColorFill, 'hiliteColor');
                btnTitleColorFill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    popupTitleColorFill.classList.toggle('visible');
                    if (popupTitleColorText) popupTitleColorText.classList.remove('visible');
                });
            }

            // Hide title toolbar on click outside
            document.addEventListener('mousedown', (e) => {
                if (!this.titleToolbar.contains(e.target) && e.target !== this.titleInput) {
                    this.titleToolbar.classList.remove('visible');
                    this.titleToolbar.classList.add('hidden');
                }
            });
        }
    }

    buildColorPalette(container, command) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'color-grid';
        this.officeColors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = color;
            swatch.addEventListener('mousedown', (e) => { // mousedown prevents losing focus
                e.preventDefault();
                e.stopPropagation();
                document.execCommand(command, false, color);
                container.classList.remove('visible');
                this.debouncedSave();
            });
            grid.appendChild(swatch);
        });
        container.appendChild(grid);
    }

    showToast(msg) {
        this.toast.textContent = msg;
        this.toast.classList.remove('hidden');
        setTimeout(() => {
            this.toast.classList.add('hidden');
        }, 1500);
    }

    async handlePaste(e) {
        const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
        const items = clipboardData.items;
        let hasImage = false;

        // Check for images first
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.includes('image/')) {
                e.preventDefault();
                let blob = item.getAsFile();
                // 压缩大图片
                blob = await this.compressImage(blob);
                const imageId = await this.db.saveImage(blob);
                this.insertImage(imageId, blob);
                hasImage = true;
            }
        }

        // If no image, clean and insert as plain text (no formatting)
        if (!hasImage) {
            e.preventDefault();
            const text = clipboardData.getData('text/plain');
            // Sanitize text
            const sanitizedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // 将换行符转换为 <br>，不需要额外包裹 span
            // 过滤掉空行避免双倍换行
            const html = sanitizedText
                .split('\n')
                .map(line => line.trim() || '')  // 保留空行但不添加额外标签
                .join('<br>');
            document.execCommand('insertHTML', false, html);
            this.debouncedSave();
        }
    }

    insertImage(id, blob) {
        const url = URL.createObjectURL(blob);
        const html = `<img src="${url}" data-id="${id}" style="max-width: 50%; border-radius: 8px; margin-top: 10px; cursor: pointer;" contenteditable="false" loading="lazy">`;
        document.execCommand('insertHTML', false, html);

        // 使用 debouncedSave 而非立即保存，以保留浏览器 Undo 栈
        // 用户可在 800ms 内撤销操作
        this.debouncedSave();
    }

    /**
     * 压缩图片 - 大于1MB的图片会被压缩
     * @param {Blob} blob 原始图片
     * @param {number} maxWidth 最大宽度 (默认1920px)
     * @param {number} quality JPEG质量 (0-1, 默认0.8)
     * @returns {Promise<Blob>} 压缩后的图片
     */
    async compressImage(blob, maxWidth = 1920, quality = 0.8) {
        // 小于1MB的图片直接返回
        if (blob.size < 1024 * 1024) {
            return blob;
        }

        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);

            img.onload = () => {
                URL.revokeObjectURL(url);

                // 计算缩放比例
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                // 使用Canvas压缩
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 转换为Blob
                canvas.toBlob((compressedBlob) => {
                    resolve(compressedBlob || blob);
                }, 'image/jpeg', quality);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(blob); // 压缩失败时返回原图
            };

            img.src = url;
        });
    }

    async createNewNote() {
        console.log('Creating new note...');
        try {
            const newNote = {
                id: Date.now(),
                title: '',
                content: '',
                tags: '',
                updatedAt: Date.now(),
                createdAt: Date.now()
            };
            await this.db.addNote(newNote);
            console.log('New note added to DB:', newNote);
            this.currentSort = 'updatedAt'; // Reset sort to show new note first usually
            this.sortSelect.value = 'updatedAt';
            await this.renderNoteList();
            this.loadNote(newNote.id);
        } catch (e) {
            console.error('Create Note Failed:', e);
            this.showAlert('创建笔记失败: ' + e.message);
        }
    }

    async renderNoteList(query = '') {
        console.log('Rendering note list...');
        let notes = [];
        let folders = [];
        try {
            notes = await this.db.getNotes();
            folders = await this.db.getFolders();
        } catch (e) {
            console.error('Failed to get notes/folders:', e);
            return;
        }

        // Sort items helper
        const sortItems = (items) => {
            const sortKey = this.currentSort || 'updatedAt';
            return items.sort((a, b) => {
                // 1. Pin priority
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;

                // 2. Sort key
                let comparison = 0;
                const valA = a[sortKey] || 0;
                const valB = b[sortKey] || 0;

                if (sortKey === 'title') {
                    comparison = (valA || '').localeCompare(valB || '');
                } else {
                    comparison = valA - valB;
                }

                // 3. Direction (Ascending/Descending)
                // For title: ascending is A-Z, descending is Z-A
                // For dates: ascending is Oldest-Newest, descending is Newest-Oldest
                // Default direction logic:
                // Dates default to Descending (Newest first)
                // Title defaults to Ascending (A-Z)

                if (sortKey === 'title') {
                    return this.sortAscending ? comparison : -comparison;
                } else {
                    // Dates: this.sortAscending=true -> Oldest(small) to Newest(large)
                    // this.sortAscending=false -> Newest(large) to Oldest(small)
                    return this.sortAscending ? comparison : -comparison;
                }
            });
        };

        notes = sortItems(notes);
        folders = sortItems(folders);

        // Filter notes by query
        const filteredNotes = notes.filter(n => {
            const q = query.toLowerCase();
            return (n.title || '').toLowerCase().includes(q) ||
                (n.content || '').toLowerCase().includes(q) ||
                (n.tags || '').toLowerCase().includes(q);
        });

        this.noteListEl.innerHTML = '';

        // Render Folders first (Root folders only)
        folders.forEach(folder => {
            // Only render root folders here (no parentId)
            if (folder.parentId) return;

            // Filter logic
            // Check if folder or any of its children (recursive) matches
            const hasMatchingNotesRecursive = (fId) => {
                const myNotes = filteredNotes.filter(n => n.folderId === fId);
                if (myNotes.length > 0) return true;
                const children = folders.filter(f => f.parentId === fId);
                return children.some(c => hasMatchingNotesRecursive(c.id));
            };

            const matchesName = query && folder.name.toLowerCase().includes(query.toLowerCase());
            const hasContent = hasMatchingNotesRecursive(folder.id);

            // If searching: Show if matches name OR has matching contents
            if (query && !matchesName && !hasContent) {
                return; // Hide folder
            }

            const folderEl = this.createFolderElement(folder, filteredNotes, query, folders);
            this.noteListEl.appendChild(folderEl);
        });

        // Render Root-level notes (notes without folderId)
        const rootNotes = filteredNotes.filter(n => !n.folderId);
        rootNotes.forEach(note => {
            const noteEl = this.createNoteElement(note, query);
            this.noteListEl.appendChild(noteEl);
        });


        // Restore Sidebar Scroll
        const sidebarScroll = localStorage.getItem('geeknote_sidebar_scroll');
        if (sidebarScroll) {
            // Use minimal timeout to allow DOM layout
            setTimeout(() => {
                this.noteListEl.scrollTop = parseInt(sidebarScroll);
            }, 0);
        }
    }

    createFolderElement(folder, allNotes, query, allFolders) {
        const container = document.createElement('div');
        container.className = 'folder-container';

        const folderEl = document.createElement('div');
        folderEl.className = 'folder-item';
        if (folder.isPinned) folderEl.classList.add('pinned');

        // Expand/Collapse state from localStorage
        const isExpanded = localStorage.getItem(`folder_${folder.id}_expanded`) !== 'false';
        if (isExpanded) folderEl.classList.add('expanded');

        const arrow = document.createElement('span');
        arrow.className = 'folder-arrow';
        arrow.textContent = '▶';

        // Check for children (notes or subfolders)
        const notesInFolder = allNotes.filter(n => n.folderId === folder.id);
        const subFolders = allFolders ? allFolders.filter(f => f.parentId === folder.id) : [];
        if (notesInFolder.length === 0 && subFolders.length === 0) {
            arrow.style.visibility = 'hidden';
        }

        const icon = document.createElement('span');
        icon.textContent = '📁';

        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = folder.name || '新文件夹';

        folderEl.appendChild(arrow);
        folderEl.appendChild(icon);
        folderEl.appendChild(name);

        if (folder.isPinned) {
            const pinIcon = document.createElement('span');
            pinIcon.className = 'pin-indicator';
            pinIcon.textContent = '★';
            folderEl.appendChild(pinIcon);
        }

        // Children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-children';
        childrenContainer.style.display = isExpanded ? 'block' : 'none';

        // Click to toggle expand
        folderEl.addEventListener('click', () => {
            folderEl.classList.toggle('expanded');
            const expanded = folderEl.classList.contains('expanded');
            localStorage.setItem(`folder_${folder.id}_expanded`, expanded);
            childrenContainer.style.display = expanded ? 'block' : 'none';
        });

        // Right-click context menu for folder
        folderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showFolderContextMenu(e.clientX, e.clientY, folder);
        });

        // Drag-drop: folder is a drop target
        folderEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            folderEl.classList.add('drag-over');
        });

        folderEl.addEventListener('dragleave', () => {
            folderEl.classList.remove('drag-over');
        });

        folderEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            folderEl.classList.remove('drag-over');
            const noteId = parseInt(e.dataTransfer.getData('text/plain'));
            if (noteId) {
                const note = await this.db.getNote(noteId);
                if (note) {
                    note.folderId = folder.id;
                    await this.db.updateNote(note);
                    this.renderNoteList(this.searchInput.value);
                    this.showToast('已移动');
                }
            }
        });

        container.appendChild(folderEl);

        // Render Sub-folders
        subFolders.forEach(subFolder => {
            // Helper logic for search filtering on subfolders could be duplicated or passed down
            // For simplicity, we just pass allFolders and let recursion handle basic structure.
            // But strict filtering might need check. 
            // Reuse the same logic: check if subFolder should be shown.
            // However, createFolderElement assumes it's being called if it SHOULD be shown?
            // Ideally yes.
            // But if we want consistent filtering:
            // Since we established `hasMatchingNotesRecursive` at root, we know *this* folder has content.
            // But we need to know which children to show.
            // A simple way: check if query exists. If so, apply filter.

            if (query) {
                const matchName = subFolder.name.toLowerCase().includes(query.toLowerCase());
                const hasContent = allNotes.filter(n => n.folderId === subFolder.id).length > 0;
                // Need deep check... simplified for now:
                // If searching, show all children if parent matches? Or filter children too?
                // Let's recursively call createFolderElement, it will build structure.
                // But we might want to hide empty branches in search.
                // For V1 of nested folders + search, let's keep it simple: Render all subfolders.
                // Or better: Re-apply `hasMatchingNotesRecursive`-like logic if needed.
            }
            // For now, just recursive call:
            const subFolderEl = this.createFolderElement(subFolder, allNotes, query, allFolders);
            childrenContainer.appendChild(subFolderEl);
        });

        // Render Notes in this folder
        notesInFolder.forEach(note => {
            const noteEl = this.createNoteElement(note, query);
            childrenContainer.appendChild(noteEl);
        });

        container.appendChild(childrenContainer);
        return container;
    }

    createNoteElement(note, query) {
        const el = document.createElement('div');
        el.className = `note-item ${this.currentNoteId === note.id ? 'active' : ''}`;
        if (note.isPinned) el.classList.add('pinned');

        // Drag and Drop support
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', note.id);
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
        });

        // Selection Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'note-checkbox';
        checkbox.checked = this.selectedNoteIds.has(note.id);
        checkbox.onclick = (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                this.selectedNoteIds.add(note.id);
            } else {
                this.selectedNoteIds.delete(note.id);
            }
            this.updateBatchActions();
        };

        // Info container
        const infoDiv = document.createElement('div');
        infoDiv.className = 'note-item-info';

        // Title
        const titleEl = document.createElement('div');
        titleEl.className = 'note-item-title';
        const titleText = note.title || '无标题';
        if (query && titleText.toLowerCase().includes(query.toLowerCase())) {
            const regex = new RegExp(`(${query})`, 'gi');
            const safeText = titleText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            titleEl.innerHTML = safeText.replace(regex, '<span class="search-highlight">$1</span>');
        } else {
            titleEl.textContent = titleText;
        }

        // Date
        const dateEl = document.createElement('div');
        dateEl.className = 'note-item-date';
        const dateObj = new Date(note.updatedAt);
        const now = new Date();
        const isToday = dateObj.getDate() === now.getDate() &&
            dateObj.getMonth() === now.getMonth() &&
            dateObj.getFullYear() === now.getFullYear();
        dateEl.textContent = isToday ?
            `今天 ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}` :
            `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;

        // Sidebar Tags (Moved before date as per request)
        if (note.tags && note.tags.trim()) {
            const tagsEl = document.createElement('div');
            tagsEl.className = 'note-item-tags';
            const tags = note.tags.split(/[,，]/).filter(t => t.trim());
            tags.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'sidebar-tag';
                tagSpan.textContent = tag.trim();
                // Task 15: Highlight matching tag
                if (query && tag.toLowerCase().includes(query.toLowerCase())) {
                    tagSpan.classList.add('search-highlight');
                }
                tagsEl.appendChild(tagSpan);
            });
            infoDiv.appendChild(tagsEl);
        }

        infoDiv.appendChild(titleEl);
        infoDiv.appendChild(dateEl);

        el.appendChild(checkbox);
        el.appendChild(infoDiv);

        if (note.isPinned) {
            const pinIcon = document.createElement('span');
            pinIcon.className = 'pin-indicator';
            pinIcon.textContent = '★';
            el.appendChild(pinIcon);
        }

        el.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                this.loadNote(note.id);
            }
        });

        // Context menu for Pin/Unpin
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNoteContextMenu(e.clientX, e.clientY, note);
        });

        return el;
    }

    updateBatchActions() {
        if (this.selectedNoteIds.size > 0) {
            this.btnBatchDelete.classList.remove('hidden');
        } else {
            this.btnBatchDelete.classList.add('hidden');
        }
    }

    // Helper for editor highlighting
    highlightEditor(noteId, query) {
        // Only if we are viewing the correct note
        if (this.currentNoteId !== noteId) return;

        // Temporarily remove existing highlights to prevent accumulation
        this.removeSearchHighlights();

        if (!query) return;

        const highlightText = (root, term) => {
            if (!term) return;
            const regex = new RegExp(`(${term})`, 'gi');
            // We need a TreeWalker to find text nodes
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) textNodes.push(node);

            // Replace text with span
            textNodes.forEach(textNode => {
                if (textNode.nodeValue && regex.test(textNode.nodeValue)) {
                    const span = document.createElement('span');
                    // Use HTML replacement for the match
                    // Be careful not to break HTML structure. 
                    // A safer way is to replace the text node with a fragment
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;
                    textNode.nodeValue.replace(regex, (match, p1, offset) => {
                        // Text before match
                        fragment.appendChild(document.createTextNode(textNode.nodeValue.substring(lastIndex, offset)));
                        // Match
                        const mark = document.createElement('span');
                        mark.className = 'search-highlight';
                        mark.textContent = match;
                        fragment.appendChild(mark);
                        lastIndex = offset + match.length;
                    });
                    // Remaining text
                    fragment.appendChild(document.createTextNode(textNode.nodeValue.substring(lastIndex)));
                    textNode.parentNode.replaceChild(fragment, textNode);
                }
            });
        };

        highlightText(this.titleInput, query);
        highlightText(this.contentInput, query);
    }

    removeSearchHighlights() {
        // Find all .search-highlight and unwrap them
        const unwrap = (root) => {
            const highlights = root.querySelectorAll('.search-highlight');
            highlights.forEach(span => {
                const parent = span.parentNode;
                while (span.firstChild) {
                    parent.insertBefore(span.firstChild, span);
                }
                parent.removeChild(span);
            });
            // Normalize to merge text nodes
            root.normalize();
        };
        unwrap(this.titleInput);
        unwrap(this.contentInput);
    }

    async loadNote(id) {
        if (this.currentNoteId) {
            localStorage.setItem(`geeknote_scroll_${this.currentNoteId}`, this.editorMain.scrollTop);
        }

        const note = await this.db.getNote(id);
        if (!note) return;

        this.currentNoteId = id;
        localStorage.setItem('geeknote_last_note_id', id);

        // Toggle UI
        this.emptyState.classList.add('hidden');
        this.editorContainer.classList.remove('hidden');

        const allItems = this.noteListEl.querySelectorAll('.note-item');
        allItems.forEach(i => i.classList.remove('active'));

        // Find the target item and mark it as active
        const targetItem = Array.from(allItems).find(i =>
            // Depending on how id is embedded, usually data-id is converted to string in dataset
            i.dataset.id === String(id) || i.querySelector(`[data-id="${id}"]`)
        );
        if (targetItem) targetItem.classList.add('active');

        // Set content - Title is now Div so innerText/textContent
        this.titleInput.innerText = note.title || '';
        // this.tagsInput.value = note.tags || ''; // Removed input
        this.renderTags(); // Render tags UI

        // 先用正则清除旧的 blob:null URL，防止浏览器在解析 innerHTML 时尝试加载这些不可用的 URL
        let cleanContent = (note.content || '').replace(/src="blob:[^"]*"/g, 'src=""');
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanContent;
        const imgs = tempDiv.querySelectorAll('img');
        for (let img of imgs) {
            // 清理可能随 HTML 保存下来的动态 UI 类名
            img.classList.remove('selected', 'resizing', 'dragging');
            img.contentEditable = "false"; // 禁用原生图片的紫色选择框/原生缩放

            if (img.dataset.id) {
                const blobData = await this.db.getImage(img.dataset.id);
                if (blobData && blobData.blob) {
                    img.src = URL.createObjectURL(blobData.blob);
                    // 保留 HTML 中保存的原始样式，仅补充缺失的默认值
                    if (!img.style.borderRadius) img.style.borderRadius = '8px';
                    // 不再覆盖 maxWidth，保留用户设置的尺寸
                } else {
                    // 图片数据丢失时
                    img.removeAttribute('src');
                    img.alt = '[图片加载失败]';
                    img.style.opacity = '0.5';
                    img.style.border = '1px dashed #666';
                    img.style.padding = '20px';
                    img.style.display = 'inline-block';
                    img.style.minWidth = '100px';
                    img.style.minHeight = '40px';
                    console.warn(`图片数据缺失: ${img.dataset.id}`);
                }
            }
        }
        // 直接移动 DOM 节点而不是用 innerHTML (避免浏览器重新解析时再次触发加载)
        this.contentInput.innerHTML = '';
        while (tempDiv.firstChild) {
            this.contentInput.appendChild(tempDiv.firstChild);
        }

        // Restore scroll position (localStorage for permanence)
        const savedScroll = localStorage.getItem(`geeknote_scroll_${id}`);
        const targetScroll = savedScroll ? parseInt(savedScroll) : 0;

        // 立刻应用目标滚动位置，防止受上一个笔记的滚动条影响导致画面跳动
        this.editorMain.scrollTop = targetScroll;

        if (targetScroll > 0) {
            // 如果目标是往下滚，可能因为此时新插入的图片还没来得及占据高度而被截断，延迟稍微补齐一次
            setTimeout(() => {
                this.editorMain.scrollTop = targetScroll;
            }, 30);
        }

        // Apply visual search highlight if there is a query
        if (this.searchInput.value) {
            this.highlightEditor(id, this.searchInput.value);
        }

        // Update metadata display
        const formatDate = (timestamp) => {
            if (!timestamp) return '--';
            const d = new Date(timestamp);
            return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        };
        const noteCreated = document.getElementById('note-created');
        const noteEdited = document.getElementById('note-edited');
        if (noteCreated) noteCreated.textContent = `创建于: ${formatDate(note.createdAt || note.id)}`;
        if (noteEdited) noteEdited.textContent = `编辑于: ${formatDate(note.updatedAt)}`;
    }

    debouncedSave() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.saveCurrentNote(), 800);
    }

    async saveCurrentNote(isManual = false) {
        if (!this.currentNoteId) return;

        // Clean highlight before saving to avoid dirty data
        // We clone the content to clean it so we don't disrupt the user's view (optional) 
        // OR we just remove highlight, save, (and optionally re-highlight).
        // Removing highlighting momentarily is safer to ensure clean data.
        this.removeSearchHighlights();

        const note = await this.db.getNote(this.currentNoteId);
        if (!note) return;

        note.title = this.titleInput.innerText.trim(); // Get text from div
        // note.tags = this.tagsInput.value; // Already updated in memory via updateTags
        note.content = this.contentInput.innerHTML;
        note.updatedAt = Date.now();
        await this.db.updateNote(note);
        await this.renderNoteList(this.searchInput.value);

        // Re-apply highlight if search is active
        if (this.searchInput.value) {
            this.highlightEditor(this.currentNoteId, this.searchInput.value);
        }

        if (isManual) {
            this.showToast('已保存');
        }
    }

    // === EXPORT/IMPORT ===
    async exportData() {
        this.showToast('正在导出...');
        try {
            const notes = await this.db.getNotes();
            const folders = await this.db.getFolders();

            // Optimization: Only export images that are actually used in notes
            const usedImageIds = new Set();
            const parser = new DOMParser();
            notes.forEach(note => {
                if (!note.content) return;
                const doc = parser.parseFromString(note.content, 'text/html');
                const imgs = doc.querySelectorAll('img[data-id]');
                // 图片 ID 是字符串格式 (如 "1775011944347-t7waa7zyl")，保持原样
                imgs.forEach(img => {
                    const idStr = img.getAttribute('data-id');
                    if (idStr) usedImageIds.add(idStr);
                });
            });

            // Get all images
            // We use getAll for simplicity since we're loading everything into memory for JSON anyway
            const transaction = this.db.db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.getAll();

            const imageRecords = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = (e) => reject(e.target.error);
            });

            // 调试日志：检查 ID 匹配情况
            console.log(`[导出] 笔记中引用的图片 ID (${usedImageIds.size}):`, [...usedImageIds].slice(0, 5));
            console.log(`[导出] IndexedDB 中的图片 (${imageRecords.length}):`, imageRecords.slice(0, 5).map(r => r.id));
            
            // 检查是否有匹配
            const matchedRecords = imageRecords.filter(img => usedImageIds.has(img.id));
            console.log(`[导出] 匹配的图片数量: ${matchedRecords.length}`);
            
            if (matchedRecords.length === 0 && usedImageIds.size > 0 && imageRecords.length > 0) {
                // ID 类型可能不匹配，尝试字符串对比
                console.warn('[导出] ID 类型可能不匹配!');
                console.log('[导出] HTML中的ID类型:', typeof [...usedImageIds][0], '值:', [...usedImageIds][0]);
                console.log('[导出] DB中的ID类型:', typeof imageRecords[0].id, '值:', imageRecords[0].id);
            }

            // Convert and Filter images in parallel
            const images = await Promise.all(
                matchedRecords
                    .map(async (img) => {
                        const base64 = await this.blobToBase64(img.blob);
                        return { id: img.id, data: base64 };
                    })
            );

            const exportObj = {
                version: 2, // Bump version
                exportedAt: new Date().toISOString(),
                notes: notes,
                folders: folders,
                images: images
            };

            const json = JSON.stringify(exportObj, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `geeknote_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast(`导出成功! (含 ${images.length} 张图片)`);
        } catch (e) {
            console.error('Export failed:', e);
            this.showAlert('导出失败: ' + e.message);
        }
    }

    async importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!await this.showConfirm('导入将智能合并到现有数据，保留最新的修改，确定继续？')) {
            this.fileImport.value = '';
            return;
        }

        this.showToast('正在导入...');
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.notes || !Array.isArray(data.notes)) {
                throw new Error('无效的数据格式');
            }

            // 1. Import Folders
            if (data.folders && Array.isArray(data.folders)) {
                const existingFolders = await this.db.getFolders();
                const folderTx = this.db.db.transaction(['folders'], 'readwrite');
                const folderStore = folderTx.objectStore('folders');
                for (const folder of data.folders) {
                    folderStore.put(folder);
                }
                await new Promise((resolve, reject) => {
                    folderTx.oncomplete = resolve;
                    folderTx.onerror = (e) => reject(e.target.error);
                });
            }

            // 2. Import Notes (Smart Merge)
            const existingNotes = await this.db.getNotes();
            const noteTx = this.db.db.transaction(['notes'], 'readwrite');
            const noteStore = noteTx.objectStore('notes');

            for (const note of data.notes) {
                // 按 ID 检查是否存在
                const existingById = existingNotes.find(en => en.id === note.id);
                if (existingById) {
                    // 如果存在，按更新时间保留最新的，避免旧备份覆盖新数据
                    if (!note.updatedAt || existingById.updatedAt >= note.updatedAt) {
                        continue; // 跳过导入
                    }
                    noteStore.put(note);
                } else {
                    // 如果 ID 不存在，检查是否有内容完全一样的重复数据（跨设备导入时可能产生）
                    const isDuplicate = existingNotes.some(en =>
                        en.title === note.title &&
                        en.content === note.content &&
                        (en.createdAt === note.createdAt || !note.createdAt)
                    );
                    if (!isDuplicate) {
                        noteStore.put(note);
                    }
                }
            }

            await new Promise((resolve, reject) => {
                noteTx.oncomplete = resolve;
                noteTx.onerror = (e) => reject(e.target.error);
            });

            // 3. Import Images
            if (data.images && Array.isArray(data.images)) {
                let importedCount = 0;
                for (const img of data.images) {
                    try {
                        const blob = await this.base64ToBlob(img.data);
                        // 使用 db._perform 而不是 this._perform (App 类没有此方法)
                        await this.db._perform('images', 'readwrite', store => store.put({ id: img.id, blob: blob }));
                        importedCount++;
                    } catch (imgErr) {
                        console.warn(`图片 ${img.id} 导入失败:`, imgErr);
                    }
                }
                console.log(`成功导入 ${importedCount}/${data.images.length} 张图片`);
            }

            this.fileImport.value = '';
            this.showToast('导入与合并成功!');
            await this.renderNoteList();

            // 导入后始终重新加载笔记，刷新图片的 ObjectURL
            if (this.currentNoteId) {
                await this.loadNote(this.currentNoteId);
            } else {
                const notes = await this.db.getNotes();
                if (notes.length > 0) {
                    await this.loadNote(notes[0].id);
                }
            }
        } catch (e) {
            console.error('Import failed:', e);
            this.showAlert('导入失败: ' + e.message);
            this.fileImport.value = '';
        }
    }

    // Helper: Blob to Base64
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Helper: Base64 to Blob
    base64ToBlob(base64) {
        return fetch(base64).then(res => res.blob());
    }

    // === FOLDER SYSTEM ===
    async createNewFolder(parentId = null) {
        const name = await this.showPrompt('输入文件夹名称:');
        if (!name || !name.trim()) return;

        const folder = {
            id: Date.now(),
            name: name.trim(),
            parentId: parentId,
            createdAt: Date.now()
        };

        try {
            await this.db.addFolder(folder);
            this.showToast('文件夹已创建');
            await this.renderNoteList(this.searchInput.value);
        } catch (e) {
            console.error('Create folder failed:', e);
            this.showAlert('创建文件夹失败: ' + e.message);
        }
    }

    // Show context menu for folder right-click
    showFolderContextMenu(x, y, folder) {
        // Remove existing menu
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'folder-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // New Note option
        const newNoteItem = document.createElement('div');
        newNoteItem.className = 'context-menu-item';
        newNoteItem.innerHTML = '📝 新建笔记';
        newNoteItem.onclick = () => {
            this.createNoteInFolder(folder.id);
            this.hideContextMenu();
        };
        menu.appendChild(newNoteItem);

        // New Folder option
        const newFolderItem = document.createElement('div');
        newFolderItem.className = 'context-menu-item';
        newFolderItem.innerHTML = '📁 新建子文件夹';
        newFolderItem.onclick = () => {
            this.createNewFolder(folder.id);
            this.hideContextMenu();
        };
        menu.appendChild(newFolderItem);

        // Rename Folder option
        const renameItem = document.createElement('div');
        renameItem.className = 'context-menu-item';
        renameItem.innerHTML = '✏️ 重命名';
        renameItem.onclick = async () => {
            const newName = await this.showPrompt('重命名文件夹:', folder.name);
            if (newName && newName.trim() && newName !== folder.name) {
                folder.name = newName.trim();
                await this.db.updateFolder(folder);
                this.renderNoteList(this.searchInput.value);
            }
            this.hideContextMenu();
        };
        menu.appendChild(renameItem);

        // Pin/Unpin option
        const pinItem = document.createElement('div');
        pinItem.className = 'context-menu-item';
        pinItem.innerHTML = folder.isPinned ? '❌ 取消置顶' : '⭐ 置顶文件夹';
        pinItem.onclick = async () => {
            folder.isPinned = !folder.isPinned;
            await this.db.updateFolder(folder);
            this.renderNoteList(this.searchInput.value);
            this.hideContextMenu();
        };
        menu.appendChild(pinItem);

        // Delete Folder option
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item danger';
        deleteItem.innerHTML = '🗑️ 删除文件夹';
        deleteItem.onclick = async () => {
            if (await this.showConfirm(`确定删除文件夹 "${folder.name}"？\n(笔记将移至根目录)`)) {
                // Move notes to root
                const notes = await this.db.getNotes();
                for (const note of notes.filter(n => n.folderId === folder.id)) {
                    note.folderId = null;
                    await this.db.updateNote(note);
                }
                await this.db.deleteFolder(folder.id);
                this.showToast('文件夹已删除');
                this.renderNoteList(this.searchInput.value);
            }
            this.hideContextMenu();
        };
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 10);
    }

    // Show context menu for note right-click
    showNoteContextMenu(x, y, note) {
        // Remove existing menu
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'note-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Pin/Unpin option
        const pinItem = document.createElement('div');
        pinItem.className = 'context-menu-item';
        pinItem.innerHTML = note.isPinned ? '❌ 取消置顶' : '⭐ 置顶笔记';
        pinItem.onclick = async () => {
            note.isPinned = !note.isPinned;
            await this.db.updateNote(note);
            this.renderNoteList(this.searchInput.value);
            this.hideContextMenu();
        };
        menu.appendChild(pinItem);

        // Move to Folder (restored functionality)
        const moveItem = document.createElement('div');
        moveItem.className = 'context-menu-item';
        moveItem.innerHTML = '📂 移动到文件夹';
        moveItem.onclick = async () => {
            const folders = await this.db.getFolders();
            if (folders.length === 0) {
                await this.showAlert('请先创建一个文件夹');
                this.hideContextMenu();
                return;
            }
            const folderNames = folders.map(f => f.name).join('\n');
            const targetName = await this.showPrompt(`移动到文件夹 (输入名称):\n${folderNames}`);
            if (targetName) {
                const targetFolder = folders.find(f => f.name === targetName.trim());
                if (targetFolder) {
                    note.folderId = targetFolder.id;
                    await this.db.updateNote(note);
                    this.renderNoteList(this.searchInput.value);
                    this.showToast('已移动');
                } else {
                    await this.showAlert('文件夹不存在');
                }
            }
            this.hideContextMenu();
        };
        menu.appendChild(moveItem);

        // Delete Note option
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item danger';
        deleteItem.innerHTML = '🗑️ 删除笔记';
        deleteItem.onclick = async () => {
            if (await this.showConfirm('确定删除这篇笔记吗？')) {
                await this.db.deleteNote(note.id);
                if (this.currentNoteId === note.id) {
                    this.currentNoteId = null;
                    this.editorContainer.classList.add('hidden');
                    this.emptyState.classList.remove('hidden');
                }
                this.renderNoteList(this.searchInput.value);
                this.showToast('笔记已删除');
            }
            this.hideContextMenu();
        };
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 10);
    }

    hideContextMenu() {
        const existingFolder = document.getElementById('folder-context-menu');
        if (existingFolder) existingFolder.remove();
        const existingNote = document.getElementById('note-context-menu');
        if (existingNote) existingNote.remove();
    }

    // Create new note directly in a folder
    async createNoteInFolder(folderId) {
        const newNote = {
            id: Date.now(),
            title: '',
            content: '',
            tags: '',
            folderId: folderId,
            updatedAt: Date.now(),
            createdAt: Date.now()
        };
        await this.db.addNote(newNote);

        // Ensure folder is expanded
        localStorage.setItem(`folder_${folderId}_expanded`, 'true');

        await this.renderNoteList(this.searchInput.value);
        this.loadNote(newNote.id);
        this.showToast('笔记已创建');
    }
    // === TAGS SYSTEM ===
    getHashColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colors = ['#FFadad', '#FFd6a5', '#Fdffb6', '#CAffbf', '#9Bf6ff', '#A0c4ff', '#BDb2ff', '#FFc6ff'];
        return colors[Math.abs(hash) % colors.length];
    }

    async updateTags(newTagsString) {
        if (!this.currentNoteId) return;
        const note = await this.db.getNote(this.currentNoteId);
        if (note) {
            note.tags = newTagsString;
            await this.db.updateNote(note);
            this.renderTags(note);
            this.debouncedSave();
            this.renderNoteList(this.searchInput.value);
        }
    }

    async renderTags(noteObj = null) {
        this.tagsList.innerHTML = '';
        const id = noteObj ? noteObj.id : this.currentNoteId;
        if (!id) return;

        let note = noteObj;
        if (!note) {
            note = await this.db.getNote(id);
        }
        if (!note) return;

        const tags = (note.tags || '').split(/[,，]/).filter(t => t.trim());
        tags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'tag-chip';
            // Deterministic pastel color based on tag name
            const randomColor = this.getHashColor(tag.trim());
            chip.style.backgroundColor = randomColor;
            chip.style.color = '#333'; // ensure readable text on pastel
            chip.style.border = 'none'; // removing default border if any
            chip.dataset.tag = tag.trim();

            const text = document.createElement('span');
            text.textContent = tag.trim();

            const removeBtn = document.createElement('span');
            removeBtn.className = 'tag-remove';
            removeBtn.innerHTML = '×';
            removeBtn.title = '移除标签';

            chip.appendChild(text);
            chip.appendChild(removeBtn);
            this.tagsList.appendChild(chip);
        });
    }

    async requestAddTag() {
        // Remove existing popup if any
        const existing = document.querySelector('.tag-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'tag-popup';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '新标签...';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'icon-btn';
        confirmBtn.textContent = '✓';
        confirmBtn.title = '添加';

        const closePopup = () => {
            if (popup.parentNode) popup.remove();
            document.removeEventListener('mousedown', onClickOutside);
        };

        const addTag = async () => {
            const val = input.value.trim();
            if (val && this.currentNoteId) {
                const note = await this.db.getNote(this.currentNoteId);
                const currentTags = (note.tags || '').split(/[,，]/).filter(t => t.trim());
                if (!currentTags.includes(val)) {
                    currentTags.push(val);
                    await this.updateTags(currentTags.join(','));
                }
            }
            closePopup();
        };

        confirmBtn.onclick = addTag;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') addTag();
            if (e.key === 'Escape') closePopup();
        };

        popup.appendChild(input);
        popup.appendChild(confirmBtn);

        // Position popup
        const rect = this.addTagBtn.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 8}px`;

        document.body.appendChild(popup);
        input.focus();

        // Close on click outside (using mousedown matches better with focus loss)
        const onClickOutside = (e) => {
            if (!popup.contains(e.target) && e.target !== this.addTagBtn && !e.target.closest('.tag-popup')) {
                closePopup();
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', onClickOutside);
        }, 10);
    }

    async removeTag(tagToRemove) {
        if (!this.currentNoteId) return;
        const note = await this.db.getNote(this.currentNoteId);
        if (note) {
            const tags = (note.tags || '').split(/[,，]/).filter(t => t.trim());
            const newTags = tags.filter(t => t !== tagToRemove);
            await this.updateTags(newTags.join(','));
        }
    }

    // === IMAGE TOOLBAR & LAYOUT ===
    initImageToolbar() {
        this.currentImg = null;

        // Close button
        this.imageToolbar.querySelector('#btn-close-img-toolbar').addEventListener('click', () => {
            this.hideImageToolbar();
        });

        // Cut button
        this.imageToolbar.querySelector('#btn-img-cut').addEventListener('click', () => {
            if (this.currentImg) {
                this.selectImage(this.currentImg);
                document.execCommand('cut');
                this.hideImageToolbar();
                this.hideResizer();
            }
        });

        // Layout buttons
        this.imageToolbar.querySelectorAll('.layout-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!this.currentImg) return;
                const mode = btn.dataset.mode;
                this.setImageLayout(this.currentImg, mode);

                // Update active state
                this.imageToolbar.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Trigger save
                this.debouncedSave();
                this.updateResizerPos(); // Reposition resizer if image moves
            });
        });

        // Global click to hide
        document.addEventListener('mousedown', (e) => {
            if (this.imageToolbar.classList.contains('visible') &&
                !this.imageToolbar.contains(e.target) &&
                e.target !== this.currentImg) {
                this.hideImageToolbar();
            }
        });

        // Editor click to show (Delegate)
        this.contentInput.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this.showImageToolbar(e.target);
            }
        });

        // Keydown for shortcuts when image is "active" (clicked)
        document.addEventListener('keydown', (e) => {
            if (!this.currentImg || !this.imageToolbar.classList.contains('visible')) return;

            // Delete / Backspace
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.currentImg.remove();
                this.hideImageToolbar();
                this.hideResizer();
                this.debouncedSave();
            }

            // Ctrl+X (Cut)
            if (e.ctrlKey && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                this.selectImage(this.currentImg);
                document.execCommand('cut');
                this.hideImageToolbar();
                this.hideResizer();
            }

            // Ctrl+C (Copy)
            if (e.ctrlKey && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                this.selectImage(this.currentImg);
                document.execCommand('copy');
                // Deselect to remove blue
                const sel = window.getSelection();
                sel.removeAllRanges();
            }
        });
    }

    selectImage(img) {
        const range = document.createRange();
        range.selectNode(img);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    showImageToolbar(img) {
        this.currentImg = img;
        // Removed selectImage(img) to prevent blue highlight
        // this.selectImage(img);

        const rect = img.getBoundingClientRect();
        const toolbarHeight = 85;
        const headerOffset = 70;

        let top = rect.top + window.scrollY - toolbarHeight;
        const left = rect.left + window.scrollX;

        if (rect.top < toolbarHeight + headerOffset) {
            top = rect.top + window.scrollY + 10;
        }

        this.imageToolbar.style.top = `${top}px`;
        this.imageToolbar.style.left = `${Math.max(10, left)}px`;
        this.imageToolbar.classList.remove('hidden');
        this.imageToolbar.classList.add('visible');

        // Hide Main Text Toolbar
        if (this.toolbar) {
            this.toolbar.classList.remove('visible');
            this.toolbar.classList.add('hidden');
        }

        // Set active button
        const float = img.style.float;
        const display = img.style.display;
        let mode = 'inline';
        if (float === 'left') mode = 'left';
        else if (float === 'right') mode = 'right';
        else if (display === 'block') mode = 'center';

        this.imageToolbar.querySelectorAll('.layout-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
    }

    hideImageToolbar() {
        if (!this.imageToolbar) return;
        this.imageToolbar.classList.remove('visible');
        this.imageToolbar.classList.add('hidden');
        this.currentImg = null;
    }

    setImageLayout(img, mode) {
        img.style.float = 'none';
        img.style.display = 'inline-block';
        img.style.margin = '0';
        img.style.clear = 'none';
        img.style.verticalAlign = 'baseline';

        if (mode === 'left') {
            img.style.float = 'left';
            img.style.margin = '0 15px 5px 0';
        } else if (mode === 'right') {
            img.style.float = 'right';
            img.style.margin = '0 0 5px 15px';
        } else if (mode === 'center') {
            img.style.display = 'block';
            img.style.margin = '1rem auto';
            img.style.clear = 'both';
        } else {
            // Inline - alignment for better editing flow
            img.style.verticalAlign = 'middle';
            img.style.margin = '2px 8px';
        }
    }

    // === IMAGE RESIZER ===
    initResizer() {
        this.resizer = document.createElement('div');
        this.resizer.className = 'resizer-overlay';
        ['nw', 'ne', 'sw', 'se'].forEach(pos => {
            const h = document.createElement('div');
            h.className = `resize-handle handle-${pos}`;
            h.dataset.pos = pos;
            this.resizer.appendChild(h);
            h.addEventListener('mousedown', this.startResize.bind(this));
        });
        document.body.appendChild(this.resizer);

        // Image selection
        this.contentInput.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this.showResizer(e.target);
                e.stopPropagation(); // prevent hiding immediately
            }
        });

        // Hide clicking elsewhere
        document.addEventListener('click', (e) => {
            // If click is NOT on resizer AND NOT on the current image
            if (!e.target.closest('.resizer-overlay') && e.target !== this.currentResizingImg) {
                this.hideResizer();
            }
        });

        // Update on scroll/resize
        // Update on scroll/resize (use editorMain for scroll)
        this.editorMain.addEventListener('scroll', () => this.updateResizerPos());

        // Hide resizer when dragging starts (to avoid ghost box)
        this.contentInput.addEventListener('dragstart', () => this.hideResizer());
        window.addEventListener('resize', () => this.updateResizerPos());
    }

    showResizer(img) {
        this.currentResizingImg = img;
        this.resizer.classList.add('active');
        this.updateResizerPos();
    }

    hideResizer() {
        this.currentResizingImg = null;
        this.resizer.classList.remove('active');
    }

    updateResizerPos() {
        if (!this.currentResizingImg) return;
        const rect = this.currentResizingImg.getBoundingClientRect();
        this.resizer.style.left = `${rect.left + window.scrollX}px`;
        this.resizer.style.top = `${rect.top + window.scrollY}px`;
        this.resizer.style.width = `${rect.width}px`;
        this.resizer.style.height = `${rect.height}px`;
    }

    startResize(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.resizeHandle = e.target.dataset.pos;
        this.resizeStartX = e.clientX;
        this.resizeStartW = this.currentResizingImg.offsetWidth;

        const onMove = (e) => this.doResize(e);
        const onUp = () => {
            this.isResizing = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this.debouncedSave(); // Persist changes
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    doResize(e) {
        if (!this.isResizing || !this.currentResizingImg) return;
        const dx = e.clientX - this.resizeStartX;

        let newW = this.resizeStartW;

        // Adjust width based on handle. 
        // Logic: Right handles (ne, se) -> width + dx. Left handles (nw, sw) -> width - dx.
        if (this.resizeHandle.includes('e')) {
            newW = this.resizeStartW + dx;
        } else {
            newW = this.resizeStartW - dx;
        }

        // Min width
        if (newW < 50) newW = 50;

        this.currentResizingImg.style.width = `${newW}px`;
        this.currentResizingImg.style.height = 'auto'; // Maintain aspect ratio

        this.updateResizerPos();
    }

    // ============ MODAL SYSTEM ============
    /**
     * Show alert modal (replaces native alert)
     * @param {string} message
     * @returns {Promise<void>}
     */
    showAlert(message) {
        return new Promise((resolve) => {
            this.modalMessage.textContent = message;
            this.modalInput.classList.add('hidden');
            this.modalCancelBtn.classList.add('hidden');
            this.modalOverlay.classList.remove('hidden');

            const cleanup = () => {
                this.modalOverlay.classList.add('hidden');
                this.modalConfirmBtn.onclick = null;
                resolve();
            };

            this.modalConfirmBtn.onclick = cleanup;
            this.modalConfirmBtn.focus();
        });
    }

    /**
     * Show confirm modal (replaces native confirm)
     * @param {string} message
     * @returns {Promise<boolean>}
     */
    showConfirm(message) {
        return new Promise((resolve) => {
            this.modalMessage.textContent = message;
            this.modalInput.classList.add('hidden');
            this.modalCancelBtn.classList.remove('hidden');
            this.modalOverlay.classList.remove('hidden');

            const cleanup = (result) => {
                this.modalOverlay.classList.add('hidden');
                this.modalConfirmBtn.onclick = null;
                this.modalCancelBtn.onclick = null;
                resolve(result);
            };

            this.modalConfirmBtn.onclick = () => cleanup(true);
            this.modalCancelBtn.onclick = () => cleanup(false);
            this.modalConfirmBtn.focus();
        });
    }

    /**
     * Show prompt modal (replaces native prompt)
     * @param {string} message
     * @param {string} defaultValue
     * @returns {Promise<string|null>}
     */
    showPrompt(message, defaultValue = '') {
        return new Promise((resolve) => {
            this.modalMessage.textContent = message;
            this.modalInput.classList.remove('hidden');
            this.modalInput.value = defaultValue;
            this.modalCancelBtn.classList.remove('hidden');
            this.modalOverlay.classList.remove('hidden');

            const cleanup = (value) => {
                this.modalOverlay.classList.add('hidden');
                this.modalConfirmBtn.onclick = null;
                this.modalCancelBtn.onclick = null;
                this.modalInput.onkeydown = null;
                resolve(value);
            };

            this.modalConfirmBtn.onclick = () => cleanup(this.modalInput.value);
            this.modalCancelBtn.onclick = () => cleanup(null);
            this.modalInput.onkeydown = (e) => {
                if (e.key === 'Enter') cleanup(this.modalInput.value);
                if (e.key === 'Escape') cleanup(null);
            };

            setTimeout(() => this.modalInput.focus(), 50);
        });
    }

    // === EASTER EGG ===
    showEasterEgg() {
        const overlay = document.getElementById('easter-egg-overlay');
        const titleEl = document.getElementById('easter-egg-title');
        const closeBtn = overlay.querySelector('.easter-egg-close');

        if (!overlay || !titleEl) return;

        // Reset and show
        titleEl.textContent = '';
        overlay.classList.remove('hidden');

        // Trigger animation after DOM update
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });

        // Typewriter effect for "wwsa"
        const text = 'wwsa';
        let i = 0;
        const typeInterval = setInterval(() => {
            if (i < text.length) {
                titleEl.textContent += text[i];
                i++;
            } else {
                clearInterval(typeInterval);
            }
        }, 150);

        // Close handlers
        const hideEasterEgg = () => {
            overlay.classList.remove('visible');
            setTimeout(() => {
                overlay.classList.add('hidden');
                titleEl.textContent = '';
            }, 300);
            document.removeEventListener('keydown', escHandler);
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') hideEasterEgg();
        };

        closeBtn.onclick = hideEasterEgg;
        overlay.onclick = (e) => {
            if (e.target === overlay) hideEasterEgg();
        };
        document.addEventListener('keydown', escHandler);
    }
}

// Initialize
window.app = new App();
window.app.init();
