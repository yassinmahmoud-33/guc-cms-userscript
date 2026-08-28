// ==UserScript==
// @name         GUC CMS Content Renamer & Batch Downloader
// @namespace    https://cms.guc.edu.eg/
// @version      1.5.0
// @description  Renames GUC CMS file downloads to match content titles and adds 1-click batch ZIP downloads per week beside the week heading.
// @author       Antigravity
// @match        https://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @match        http://cms.guc.edu.eg/apps/student/CourseViewStn.aspx*
// @icon         https://cms.guc.edu.eg/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @connect      *
// @connect      cms.guc.edu.eg
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION & SELECTORS
    // =========================================================================
    const CONFIG = {
        // Individual content item cards
        ITEM_CARD_SELECTOR: 'div.card.mb-4',

        // Download link selector inside each card
        DOWNLOAD_LINK_SELECTOR: 'a#download.contentbtn, a.contentbtn[href*="/Uploads/"]',

        // Title element selector inside each card
        TITLE_STRONG_SELECTOR: 'div[id^="content"] strong',
        TITLE_CONTAINER_SELECTOR: 'div[id^="content"]',

        // VoD "Watch Video" button selector
        VOD_BUTTON_SELECTOR: 'input.vodbutton, .vodbutton',

        // Week heading selector
        WEEK_HEADING_SELECTOR: 'h2.text-big, h1.text-big, h2, h3',

        // Maximum safe filename character length (excluding extension)
        MAX_FILENAME_LENGTH: 150,

        // Whether to include VoD (MP4) files in the weekly ZIP archive
        INCLUDE_VOD_IN_ZIP: true,

        // Concurrent download limit for batch fetching
        CONCURRENCY_LIMIT: 3,

        // Request timeout in milliseconds (30 seconds)
        REQUEST_TIMEOUT_MS: 30000
    };

    // =========================================================================
    // BUILT-IN PURE JS SYNCHRONOUS ZIP GENERATOR (Zero Hangs, Zero Dependencies)
    // =========================================================================

    const CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        CRC_TABLE[i] = c;
    }

    function calculateCRC32(buf) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * Builds a standard uncompressed ZIP file Uint8Array in memory.
     * Takes an array of objects: [{ name: "FileName.pdf", data: ArrayBuffer | Uint8Array }, ...]
     */
    function buildZipSynchronous(files) {
        const encoder = new TextEncoder();
        const parts = [];
        const cdEntries = [];
        let offset = 0;

        for (const file of files) {
            const nameBytes = encoder.encode(file.name);
            const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
            const crc = calculateCRC32(data);
            const size = data.length;

            // Local header (30 bytes + filename)
            const localHeader = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(localHeader.buffer);
            lv.setUint32(0, 0x04034b50, true); // Local header signature
            lv.setUint16(4, 20, true);         // Version needed (2.0)
            lv.setUint16(6, 0x0800, true);     // Flags (UTF-8)
            lv.setUint16(8, 0, true);          // Compression (0 = STORE)
            lv.setUint16(10, 0x5460, true);    // Mod time (10:35 AM)
            lv.setUint16(12, 0x5821, true);    // Mod date (2024-01-01)
            lv.setUint32(14, crc, true);       // CRC32
            lv.setUint32(18, size, true);      // Compressed size
            lv.setUint32(22, size, true);      // Uncompressed size
            lv.setUint16(26, nameBytes.length, true); // Name length
            lv.setUint16(28, 0, true);         // Extra field length
            localHeader.set(nameBytes, 30);

            parts.push(localHeader);
            parts.push(data);

            // Central Directory Entry (46 bytes + filename)
            const cdEntry = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(cdEntry.buffer);
            cv.setUint32(0, 0x02014b50, true); // Central header signature
            cv.setUint16(4, 20, true);         // Version made by
            cv.setUint16(6, 20, true);         // Version needed
            cv.setUint16(8, 0x0800, true);     // Flags (UTF-8)
            cv.setUint16(10, 0, true);         // Compression (STORE)
            cv.setUint16(12, 0x5460, true);    // Mod time
            cv.setUint16(14, 0x5821, true);    // Mod date
            cv.setUint32(16, crc, true);       // CRC32
            cv.setUint32(20, size, true);      // Compressed size
            cv.setUint32(24, size, true);      // Uncompressed size
            cv.setUint16(28, nameBytes.length, true); // Name length
            cv.setUint16(30, 0, true);         // Extra field length
            cv.setUint16(32, 0, true);         // Comment length
            cv.setUint16(34, 0, true);         // Disk start
            cv.setUint16(36, 0, true);         // Internal attr
            cv.setUint32(38, 0x81a40000, true);// External attr (-rw-r--r--)
            cv.setUint32(42, offset, true);    // Local header offset
            cdEntry.set(nameBytes, 46);

            cdEntries.push(cdEntry);
            offset += localHeader.length + data.length;
        }

        const cdOffset = offset;
        let cdSize = 0;
        for (const cd of cdEntries) {
            parts.push(cd);
            cdSize += cd.length;
        }

        // End of central directory record (22 bytes)
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true); // EOCD signature
        ev.setUint16(4, 0, true);          // Disk number
        ev.setUint16(6, 0, true);          // Disk with CD
        ev.setUint16(8, files.length, true);// Disk entries
        ev.setUint16(10, files.length, true);// Total entries
        ev.setUint32(12, cdSize, true);    // CD size
        ev.setUint32(16, cdOffset, true);  // CD offset
        ev.setUint16(20, 0, true);         // Comment length
        parts.push(eocd);

        let totalLength = parts.reduce((acc, p) => acc + p.length, 0);
        const fullZipBuffer = new Uint8Array(totalLength);
        let currentPos = 0;
        for (const p of parts) {
            fullZipBuffer.set(p, currentPos);
            currentPos += p.length;
        }

        return fullZipBuffer;
    }

    // =========================================================================
    // STYLES
    // =========================================================================
    const STYLES = `
        .guc-week-heading-wrapper {
            display: inline-flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
        }

        .guc-zip-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 12px;
            padding: 5px 12px;
            font-size: 13px;
            font-weight: 600;
            line-height: 1.4;
            color: #ffffff !important;
            background: linear-gradient(135deg, #0d6efd, #0b5ed7);
            border: 1px solid #0a58ca;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(13, 110, 253, 0.2);
            transition: all 0.2s ease-in-out;
            text-decoration: none !important;
            vertical-align: middle;
        }
        .guc-zip-btn:hover {
            background: linear-gradient(135deg, #0b5ed7, #0a58ca);
            box-shadow: 0 4px 8px rgba(13, 110, 253, 0.3);
            transform: translateY(-1px);
        }
        .guc-zip-btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(13, 110, 253, 0.2);
        }
        .guc-zip-btn:disabled, .guc-zip-btn.busy {
            background: #6c757d !important;
            border-color: #5c636a !important;
            cursor: not-allowed !important;
            transform: none !important;
            box-shadow: none !important;
        }
        .guc-zip-btn.ready {
            background: linear-gradient(135deg, #198754, #157347) !important;
            border-color: #146c43 !important;
            cursor: pointer !important;
        }

        .guc-zip-count-badge {
            background: rgba(255, 255, 255, 0.28);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 700;
        }

        .guc-vod-dl-btn {
            margin-left: 6px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 500;
            color: #ffffff !important;
            background-color: #198754;
            border: 1px solid #157347;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s ease-in-out;
            display: inline-block;
            text-decoration: none !important;
        }
        .guc-vod-dl-btn:hover {
            background-color: #157347;
        }

        .guc-progress-modal {
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 380px;
            background: #ffffff;
            color: #212529;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
            padding: 16px 20px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            font-size: 13px;
            border: 1px solid #dee2e6;
            border-left: 6px solid #0d6efd;
            transition: all 0.3s ease;
        }
        .guc-progress-header {
            font-weight: 700;
            font-size: 14px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .guc-progress-bar-bg {
            width: 100%;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }
        .guc-progress-bar-fill {
            height: 100%;
            width: 0%;
            background: #0d6efd;
            transition: width 0.2s ease;
        }
        .guc-progress-status {
            color: #495057;
            font-size: 12px;
            margin-bottom: 8px;
            line-height: 1.4;
            max-height: 48px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .guc-dl-link-btn {
            display: block;
            width: 100%;
            padding: 8px;
            margin-top: 10px;
            background: #198754;
            color: #ffffff !important;
            text-align: center;
            font-weight: 600;
            border-radius: 6px;
            text-decoration: none !important;
            cursor: pointer;
            box-sizing: border-box;
        }
        .guc-dl-link-btn:hover {
            background: #157347;
        }
        .guc-modal-close {
            cursor: pointer;
            background: none;
            border: none;
            font-size: 16px;
            color: #adb5bd;
            line-height: 1;
        }
        .guc-modal-close:hover {
            color: #495057;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(STYLES);
    } else {
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);
    }

    // =========================================================================
    // PROGRESS MODAL UI
    // =========================================================================

    let progressModalEl = null;

    function showProgressModal(title) {
        if (!progressModalEl) {
            progressModalEl = document.createElement('div');
            progressModalEl.className = 'guc-progress-modal';
            document.body.appendChild(progressModalEl);
        }

        progressModalEl.innerHTML = `
            <div class="guc-progress-header">
                <span>📦 ${title}</span>
                <button class="guc-modal-close" title="Close">✕</button>
            </div>
            <div class="guc-progress-bar-bg">
                <div class="guc-progress-bar-fill" id="guc-pbar"></div>
            </div>
            <div class="guc-progress-status" id="guc-pstatus">Initializing download...</div>
            <div id="guc-paction"></div>
        `;

        progressModalEl.querySelector('.guc-modal-close').onclick = () => {
            if (progressModalEl && progressModalEl.parentNode) {
                progressModalEl.parentNode.removeChild(progressModalEl);
                progressModalEl = null;
            }
        };
    }

    function updateProgressModal(percent, statusHtml, actionHtml = null) {
        if (!progressModalEl) return;
        const pbar = progressModalEl.querySelector('#guc-pbar');
        const pstatus = progressModalEl.querySelector('#guc-pstatus');
        const paction = progressModalEl.querySelector('#guc-paction');

        if (pbar) pbar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        if (pstatus) pstatus.innerHTML = statusHtml;
        if (actionHtml !== null && paction) paction.innerHTML = actionHtml;
    }

    function closeProgressModal(delayMs = 5000) {
        setTimeout(() => {
            if (progressModalEl && progressModalEl.parentNode) {
                progressModalEl.parentNode.removeChild(progressModalEl);
                progressModalEl = null;
            }
        }, delayMs);
    }

    // =========================================================================
    // FILENAME & DOM EXTRACTION UTILITIES
    // =========================================================================

    function sanitizeFilename(name, maxLen = CONFIG.MAX_FILENAME_LENGTH) {
        if (!name) return 'Untitled';

        let clean = name
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        clean = clean.replace(/[. ]+$/, '');

        if (clean.length > maxLen) {
            clean = clean.substring(0, maxLen).trim().replace(/[. ]+$/, '');
        }

        return clean || 'Untitled';
    }

    function extractExtensionFromUrl(url) {
        if (!url) return '.pdf';
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
            const dotIndex = lastSegment.lastIndexOf('.');
            if (dotIndex !== -1 && dotIndex < lastSegment.length - 1) {
                const ext = lastSegment.substring(dotIndex).toLowerCase();
                if (/^\.[a-z0-9]{1,6}$/i.test(ext)) {
                    return ext;
                }
            }
        } catch (e) {
            console.warn('[GUC CMS] Extension parse warning:', url, e);
        }
        return '.pdf';
    }

    function extractItemInfo(card) {
        if (!card) return null;

        const downloadLink = card.querySelector(CONFIG.DOWNLOAD_LINK_SELECTOR);
        if (!downloadLink) return null;

        const rawHref = downloadLink.getAttribute('href') || downloadLink.href || '';
        if (!rawHref || rawHref.startsWith('javascript:')) return null;

        const absoluteUrl = new URL(rawHref, window.location.origin).href;
        const contentId = downloadLink.getAttribute('data-contentid') || '';
        const ext = extractExtensionFromUrl(rawHref);

        const titleStrong = card.querySelector(CONFIG.TITLE_STRONG_SELECTOR);
        const titleContainer = card.querySelector(CONFIG.TITLE_CONTAINER_SELECTOR);

        let mainTitle = '';
        let typeSuffix = '';

        if (titleStrong && titleStrong.textContent.trim()) {
            mainTitle = titleStrong.textContent.trim();

            if (titleContainer) {
                const fullContainerText = titleContainer.textContent.trim();
                const strongText = titleStrong.textContent.trim();
                const afterStrong = fullContainerText.replace(strongText, '').trim();
                if (afterStrong && /^\([^)]+\)/.test(afterStrong)) {
                    typeSuffix = ' ' + afterStrong.match(/^\([^)]+\)/)[0];
                }
            }
        } else if (titleContainer && titleContainer.textContent.trim()) {
            mainTitle = titleContainer.textContent.trim();
        } else {
            mainTitle = `Content_${contentId || Date.now()}`;
        }

        const linkHidden = (downloadLink.style.display === 'none' || downloadLink.hidden || downloadLink.getAttribute('style')?.includes('display:none'));
        const vodButton = card.querySelector(CONFIG.VOD_BUTTON_SELECTOR);
        const vodButtonVisible = vodButton && vodButton.style.display !== 'none' && !vodButton.getAttribute('style')?.includes('display:none');

        const isVod = ext === '.mp4' || ext === '.mkv' || typeSuffix.toLowerCase().includes('vod') || (linkHidden && vodButtonVisible);

        const baseTitle = sanitizeFilename(mainTitle + typeSuffix);

        return {
            cardElement: card,
            downloadLinkElement: downloadLink,
            contentId: contentId,
            url: absoluteUrl,
            rawHref: rawHref,
            baseTitle: baseTitle,
            extension: ext,
            isVod: isVod,
            linkHidden: linkHidden
        };
    }

    function deduplicateFilenames(items) {
        const titleCounts = new Map();

        return items.map(item => {
            const key = `${item.baseTitle.toLowerCase()}${item.extension.toLowerCase()}`;
            const count = (titleCounts.get(key) || 0) + 1;
            titleCounts.set(key, count);

            let finalName = '';
            if (count === 1) {
                finalName = `${item.baseTitle}${item.extension}`;
            } else {
                finalName = `${item.baseTitle} (${count - 1})${item.extension}`;
            }

            return {
                ...item,
                uniqueFilename: finalName
            };
        });
    }

    // =========================================================================
    // RELIABLE BINARY FETCHING
    // =========================================================================

    function fetchFileArrayBuffer(url) {
        return new Promise((resolve, reject) => {
            let finished = false;
            const timer = setTimeout(() => {
                if (!finished) {
                    finished = true;
                    reject(new Error(`Timeout fetching file (${CONFIG.REQUEST_TIMEOUT_MS / 1000}s)`));
                }
            }, CONFIG.REQUEST_TIMEOUT_MS);

            // Primary: GM_xmlhttpRequest with Referer header
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                try {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        responseType: 'arraybuffer',
                        timeout: CONFIG.REQUEST_TIMEOUT_MS,
                        headers: {
                            'Referer': window.location.href,
                            'Accept': '*/*'
                        },
                        onload: (res) => {
                            if (finished) return;
                            finished = true;
                            clearTimeout(timer);
                            if (res.status >= 200 && res.status < 300) {
                                resolve(res.response);
                            } else {
                                reject(new Error(`HTTP ${res.status}: ${res.statusText || 'Server Error'}`));
                            }
                        },
                        onerror: (err) => {
                            if (finished) return;
                            tryFetchFallback(url, resolve, reject, timer);
                        },
                        ontimeout: () => {
                            if (finished) return;
                            finished = true;
                            clearTimeout(timer);
                            reject(new Error('GM_xmlhttpRequest request timed out'));
                        }
                    });
                    return;
                } catch (gmErr) {
                    console.warn('[GUC CMS] GM_xmlhttpRequest error, using fetch fallback:', gmErr);
                }
            }

            // Fallback: window.fetch
            tryFetchFallback(url, resolve, reject, timer);
        });
    }

    function tryFetchFallback(url, resolve, reject, timer) {
        window.fetch(url, { method: 'GET', credentials: 'include' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.arrayBuffer();
            })
            .then(buf => {
                clearTimeout(timer);
                resolve(buf);
            })
            .catch(err => {
                clearTimeout(timer);
                reject(err);
            });
    }

    function triggerDownloadBlob(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);

        if (typeof GM_download === 'function') {
            try {
                GM_download({
                    url: blobUrl,
                    name: filename,
                    saveAs: false,
                    onload: () => {
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
                    },
                    onerror: () => {
                        fallbackAnchorClick(blobUrl, filename);
                    }
                });
                return blobUrl;
            } catch (e) {
                console.warn('[GUC CMS] GM_download failed, using anchor click:', e);
            }
        }

        fallbackAnchorClick(blobUrl, filename);
        return blobUrl;
    }

    function fallbackAnchorClick(blobUrl, filename) {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }, 30000);
    }

    // =========================================================================
    // FEATURE 1: ENHANCE & RENAME INDIVIDUAL DOWNLOAD LINKS
    // =========================================================================

    async function triggerSingleDownload(item, buttonEl) {
        const originalText = buttonEl ? (buttonEl.innerText || buttonEl.value) : '';
        if (buttonEl) {
            buttonEl.innerText = '⏳ Downloading...';
            buttonEl.disabled = true;
        }

        try {
            const buffer = await fetchFileArrayBuffer(item.url);
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const filename = item.uniqueFilename || `${item.baseTitle}${item.extension}`;

            triggerDownloadBlob(blob, filename);

            if (buttonEl) {
                buttonEl.innerText = '✓ Downloaded';
                setTimeout(() => {
                    buttonEl.innerText = originalText;
                    buttonEl.disabled = false;
                }, 2000);
            }
        } catch (err) {
            console.error('[GUC CMS] Download error:', err);
            if (buttonEl) {
                buttonEl.innerText = '❌ Failed';
                setTimeout(() => {
                    buttonEl.innerText = originalText;
                    buttonEl.disabled = false;
                }, 3000);
            }
            window.location.href = item.url;
        }
    }

    function enhanceSingleDownloadLinks() {
        const cards = Array.from(document.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR));
        if (!cards.length) return;

        const parsedItems = cards.map(c => extractItemInfo(c)).filter(Boolean);
        const deduplicatedItems = deduplicateFilenames(parsedItems);

        deduplicatedItems.forEach(item => {
            const link = item.downloadLinkElement;
            if (!link) return;

            link.setAttribute('download', item.uniqueFilename);
            link.setAttribute('title', `Save as: ${item.uniqueFilename}`);

            if (!link.hasAttribute('data-guc-renamer-bound')) {
                link.setAttribute('data-guc-renamer-bound', 'true');

                link.addEventListener('click', function (e) {
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerSingleDownload(item, link);
                    }
                }, true);
            }

            if (item.linkHidden && item.isVod) {
                const parentDiv = link.parentElement;
                if (parentDiv && !parentDiv.querySelector('.guc-vod-dl-btn')) {
                    const vodDlBtn = document.createElement('button');
                    vodDlBtn.type = 'button';
                    vodDlBtn.className = 'guc-vod-dl-btn';
                    vodDlBtn.innerHTML = `📥 Download Video (${item.extension.toUpperCase().replace('.', '')})`;
                    vodDlBtn.setAttribute('title', `Download ${item.uniqueFilename}`);

                    vodDlBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerSingleDownload(item, vodDlBtn);
                    });

                    parentDiv.appendChild(vodDlBtn);
                }
            }
        });
    }

    // =========================================================================
    // FEATURE 2: BATCH DOWNLOAD WEEK / SECTION AS ZIP
    // =========================================================================

    async function executeBatchZip(sectionTitle, items, statusBtn) {
        if (!items || items.length === 0) {
            alert('No downloadable files found in this section.');
            return;
        }

        const originalBtnHtml = statusBtn.innerHTML;
        statusBtn.classList.add('busy');
        statusBtn.disabled = true;

        showProgressModal(sectionTitle);
        updateProgressModal(5, `Found ${items.length} files. Starting download...`);

        const deduplicated = deduplicateFilenames(items);
        const total = deduplicated.length;
        const downloadedBuffers = [];
        let completed = 0;
        let failedCount = 0;

        console.log(`[GUC CMS] Starting batch ZIP for "${sectionTitle}" (${total} files)...`);

        let currentIndex = 0;
        async function worker() {
            while (currentIndex < deduplicated.length) {
                const itemIndex = currentIndex++;
                const item = deduplicated[itemIndex];

                const currentPercent = 10 + Math.round((completed / total) * 80);
                statusBtn.innerHTML = `⏳ (${completed + 1}/${total}) ${item.uniqueFilename.substring(0, 14)}...`;
                updateProgressModal(
                    currentPercent,
                    `[${completed + 1}/${total}] Fetching <strong>${item.uniqueFilename}</strong>`
                );

                try {
                    console.log(`[GUC CMS] Fetching: ${item.uniqueFilename} (${item.url})`);
                    const arrayBuffer = await fetchFileArrayBuffer(item.url);

                    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                        throw new Error('Received empty file buffer (0 bytes)');
                    }

                    downloadedBuffers.push({
                        name: item.uniqueFilename,
                        data: arrayBuffer
                    });
                    completed++;
                    console.log(`[GUC CMS] Successfully loaded (${completed}/${total}): ${item.uniqueFilename}`);
                } catch (err) {
                    console.error(`[GUC CMS] Failed to fetch "${item.uniqueFilename}":`, err);
                    failedCount++;
                }
            }
        }

        const workers = [];
        const poolSize = Math.min(CONFIG.CONCURRENCY_LIMIT, total);
        for (let i = 0; i < poolSize; i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        if (completed === 0) {
            updateProgressModal(100, `❌ Failed to download any files for "${sectionTitle}".`);
            statusBtn.innerHTML = '❌ Download Failed';
            setTimeout(() => {
                statusBtn.innerHTML = originalBtnHtml;
                statusBtn.classList.remove('busy');
                statusBtn.disabled = false;
            }, 3500);
            return;
        }

        // Synchronously build the ZIP in memory (instant, 0ms lag, no stream hanging!)
        statusBtn.innerHTML = `📦 Zipping (${completed} files)...`;
        updateProgressModal(95, `Building ZIP archive (${completed} files)...`);
        console.log(`[GUC CMS] Building synchronous ZIP for ${completed} items...`);

        try {
            const zipBytes = buildZipSynchronous(downloadedBuffers);
            const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
            const cleanZipName = `${sanitizeFilename(sectionTitle)} - GUC CMS.zip`;
            const blobSizeMb = (zipBlob.size / (1024 * 1024)).toFixed(2);

            console.log(`[GUC CMS] ZIP built instantly! Size: ${blobSizeMb} MB (${zipBlob.size} bytes)`);

            // Trigger download
            const blobUrl = triggerDownloadBlob(zipBlob, cleanZipName);

            // Update UI with ready state & direct clickable button in case auto-download was blocked
            updateProgressModal(
                100,
                `✅ ZIP ready (${blobSizeMb} MB). Download started!`,
                `<a href="${blobUrl}" download="${cleanZipName}" class="guc-dl-link-btn">💾 Click here if download didn't start</a>`
            );

            statusBtn.innerHTML = `✅ Complete! (${blobSizeMb} MB)`;
            statusBtn.classList.remove('busy');
            statusBtn.classList.add('ready');

            closeProgressModal(8000);
        } catch (zipErr) {
            console.error('[GUC CMS] Error building ZIP:', zipErr);
            updateProgressModal(100, `❌ ZIP building error: ${zipErr.message}`);
            statusBtn.innerHTML = '❌ ZIP Error';
        } finally {
            setTimeout(() => {
                statusBtn.innerHTML = originalBtnHtml;
                statusBtn.classList.remove('busy');
                statusBtn.classList.remove('ready');
                statusBtn.disabled = false;
            }, 6000);
        }
    }

    /**
     * Injects ZIP download button beside each Week heading.
     */
    function injectZipButtons() {
        const headings = Array.from(document.querySelectorAll(CONFIG.WEEK_HEADING_SELECTOR)).filter(h => {
            const text = (h.textContent || '').trim();
            return /^week[:\s]/i.test(text) && !h.closest('.card.mb-4');
        });

        headings.forEach((heading, idx) => {
            if (heading.querySelector('.guc-zip-btn') || heading.getAttribute('data-guc-zip-bound')) return;

            const rawTitle = heading.textContent.replace(/Download.*Zip/gi, '').trim() || `Week ${idx + 1}`;
            const weekContainer = heading.closest('.card:not(.mb-4), .panel, .tab-pane') || heading.closest('.row')?.parentElement || document.body;

            let collectedCards = [];

            if (weekContainer !== document.body) {
                const containerHeadings = weekContainer.querySelectorAll('h2.text-big, h1.text-big');
                if (containerHeadings.length <= 1) {
                    collectedCards = Array.from(weekContainer.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR));
                }
            }

            if (collectedCards.length === 0) {
                let current = heading.closest('.row') || heading;
                let next = current.nextElementSibling;
                while (next) {
                    if (next.querySelector('h2.text-big') || (next.matches('h2') && /^week[:\s]/i.test(next.textContent))) {
                        break;
                    }
                    if (next.matches(CONFIG.ITEM_CARD_SELECTOR)) {
                        collectedCards.push(next);
                    } else {
                        const nested = next.querySelectorAll(CONFIG.ITEM_CARD_SELECTOR);
                        nested.forEach(c => collectedCards.push(c));
                    }
                    next = next.nextElementSibling;
                }
            }

            if (collectedCards.length > 0) {
                heading.setAttribute('data-guc-zip-bound', 'true');
                heading.classList.add('guc-week-heading-wrapper');

                const items = collectedCards.map(c => extractItemInfo(c)).filter(Boolean);
                const filteredItems = CONFIG.INCLUDE_VOD_IN_ZIP ? items : items.filter(i => !i.isVod);

                const zipBtn = createZipButton(rawTitle, filteredItems);
                heading.appendChild(zipBtn);
            }
        });
    }

    function createZipButton(title, items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'guc-zip-btn';
        btn.innerHTML = `📦 Download Week as ZIP <span class="guc-zip-count-badge">${items.length}</span>`;
        btn.title = `Download all ${items.length} files in this section as a ZIP archive`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeBatchZip(title, items, btn);
        });

        return btn;
    }

    // =========================================================================
    // INITIALIZATION & MUTATION OBSERVER
    // =========================================================================

    function runAll() {
        enhanceSingleDownloadLinks();
        injectZipButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runAll);
    } else {
        runAll();
    }

    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const mut of mutations) {
            if (mut.addedNodes.length > 0) {
                shouldUpdate = true;
                break;
            }
        }

        if (shouldUpdate) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                runAll();
            }, 300);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[GUC CMS] Content Renamer & Batch Downloader v1.5.0 initialized.');
})();