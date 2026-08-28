// ==UserScript==
// @name         GUC CMS Content Renamer & Batch Downloader
// @namespace    https://cms.guc.edu.eg/
// @version      1.8.0
// @description  Renames GUC CMS file downloads to match content titles, adds 1-click single-week ZIP downloads, and a smooth collapsible dropdown menu to select and batch download multiple weeks.
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
        ITEM_CARD_SELECTOR: 'div.card.mb-4',
        DOWNLOAD_LINK_SELECTOR: 'a#download.contentbtn, a.contentbtn[href*="/Uploads/"]',
        TITLE_STRONG_SELECTOR: 'div[id^="content"] strong',
        TITLE_CONTAINER_SELECTOR: 'div[id^="content"]',
        VOD_BUTTON_SELECTOR: 'input.vodbutton, .vodbutton',
        WEEK_HEADING_SELECTOR: 'h2.text-big, h1.text-big, h2, h3',
        MAX_FILENAME_LENGTH: 150,
        INCLUDE_VOD_IN_ZIP: true,
        CONCURRENCY_LIMIT: 3,
        REQUEST_TIMEOUT_MS: 30000
    };

    // =========================================================================
    // BUILT-IN PURE JS SYNCHRONOUS ZIP GENERATOR (Zero Hangs, Subfolder Support)
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
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(6, 0x0800, true);
            lv.setUint16(8, 0, true);
            lv.setUint16(10, 0x5460, true);
            lv.setUint16(12, 0x5821, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            localHeader.set(nameBytes, 30);

            parts.push(localHeader);
            parts.push(data);

            // Central Directory Entry (46 bytes + filename)
            const cdEntry = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(cdEntry.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, 0x5460, true);
            cv.setUint16(14, 0x5821, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0x81a40000, true);
            cv.setUint32(42, offset, true);
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
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, cdSize, true);
        ev.setUint32(16, cdOffset, true);
        ev.setUint16(20, 0, true);
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
            gap: 10px !important;
        }

        .guc-week-select-label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 8px;
            font-size: 13px;
            font-weight: 500;
            color: #495057;
            cursor: pointer;
            user-select: none;
            background: #f8f9fa;
            border: 1px solid #ced4da;
            padding: 4px 10px;
            border-radius: 6px;
            transition: all 0.15s ease;
        }
        .guc-week-select-label:hover {
            background: #e9ecef;
            border-color: #adb5bd;
        }
        .guc-week-checkbox {
            cursor: pointer;
            width: 16px;
            height: 16px;
            margin: 0;
            accent-color: #0d6efd;
        }

        .guc-zip-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
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

        /* Dropdown Toolbar & Menu */
        .guc-dropdown-container {
            position: relative;
            display: inline-block;
            margin: 15px 0;
            z-index: 1000;
        }
        .guc-dropdown-toggle-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 9px 18px;
            font-size: 14px;
            font-weight: 600;
            color: #ffffff !important;
            background: linear-gradient(135deg, #0d6efd, #0b5ed7);
            border: 1px solid #0a58ca;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(13, 110, 253, 0.25);
            transition: all 0.2s ease;
            user-select: none;
        }
        .guc-dropdown-toggle-btn:hover {
            background: linear-gradient(135deg, #0b5ed7, #0a58ca);
            transform: translateY(-1px);
            box-shadow: 0 6px 14px rgba(13, 110, 253, 0.35);
        }
        .guc-dropdown-arrow {
            transition: transform 0.25s ease;
            font-size: 11px;
        }
        .guc-dropdown-container.open .guc-dropdown-arrow {
            transform: rotate(180deg);
        }

        .guc-dropdown-menu {
            display: none;
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            width: 380px;
            max-width: 90vw;
            background: #ffffff;
            border: 1px solid #dee2e6;
            border-radius: 10px;
            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.2);
            padding: 14px;
            z-index: 10000;
        }
        .guc-dropdown-container.open .guc-dropdown-menu {
            display: block;
        }

        .guc-dd-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 10px;
            border-bottom: 1px solid #e9ecef;
            margin-bottom: 10px;
        }
        .guc-dd-title {
            font-weight: 700;
            font-size: 13px;
            color: #343a40;
        }
        .guc-dd-quick-actions {
            display: flex;
            gap: 6px;
        }
        .guc-dd-btn-sm {
            background: #f8f9fa;
            border: 1px solid #ced4da;
            color: #495057;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .guc-dd-btn-sm:hover {
            background: #e9ecef;
            border-color: #adb5bd;
            color: #212529;
        }

        .guc-dd-weeks-list {
            max-height: 250px;
            overflow-y: auto;
            margin-bottom: 12px;
            padding-right: 4px;
        }
        .guc-dd-weeks-list::-webkit-scrollbar {
            width: 6px;
        }
        .guc-dd-weeks-list::-webkit-scrollbar-thumb {
            background: #ced4da;
            border-radius: 3px;
        }

        .guc-dd-week-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 10px;
            border-radius: 6px;
            transition: background 0.15s ease;
            cursor: pointer;
            user-select: none;
            margin-bottom: 2px;
        }
        .guc-dd-week-item:hover {
            background: #f1f3f5;
        }
        .guc-dd-week-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
            color: #212529;
        }
        .guc-dd-week-badge {
            font-size: 11px;
            font-weight: 600;
            color: #6c757d;
            background: #e9ecef;
            padding: 2px 7px;
            border-radius: 10px;
        }

        .guc-dd-download-btn {
            width: 100%;
            padding: 10px;
            background: linear-gradient(135deg, #198754, #157347);
            color: #ffffff !important;
            border: none;
            border-radius: 6px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            box-shadow: 0 3px 8px rgba(25, 135, 84, 0.25);
            transition: all 0.2s ease;
        }
        .guc-dd-download-btn:hover {
            background: linear-gradient(135deg, #157347, #0f5132);
            box-shadow: 0 5px 12px rgba(25, 135, 84, 0.35);
        }
        .guc-dd-download-btn:disabled {
            background: #6c757d !important;
            cursor: not-allowed !important;
            box-shadow: none !important;
        }

        /* Floating Progress Modal */
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
                        onerror: () => {
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
    // FEATURE 2: BATCH ZIP PIPELINE (Single Week & Multi-Week)
    // =========================================================================

    async function executeZipDownloadPipeline(archiveTitle, fileEntries, statusBtn = null) {
        if (!fileEntries || fileEntries.length === 0) {
            alert('No downloadable files found in selection.');
            return;
        }

        const originalBtnHtml = statusBtn ? statusBtn.innerHTML : '';
        if (statusBtn) {
            statusBtn.classList.add('busy');
            statusBtn.disabled = true;
        }

        showProgressModal(archiveTitle);
        updateProgressModal(5, `Starting batch download of ${fileEntries.length} files...`);

        const total = fileEntries.length;
        const downloadedFiles = [];
        let completed = 0;
        let failedCount = 0;

        console.log(`[GUC CMS] Starting batch ZIP pipeline for "${archiveTitle}" (${total} files)...`);

        let currentIndex = 0;
        async function worker() {
            while (currentIndex < fileEntries.length) {
                const itemIndex = currentIndex++;
                const fileItem = fileEntries[itemIndex];

                const currentPercent = 10 + Math.round((completed / total) * 80);
                if (statusBtn) {
                    statusBtn.innerHTML = `⏳ (${completed + 1}/${total})...`;
                }
                updateProgressModal(
                    currentPercent,
                    `[${completed + 1}/${total}] Fetching <strong>${fileItem.name}</strong>`
                );

                try {
                    const arrayBuffer = await fetchFileArrayBuffer(fileItem.url);

                    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                        throw new Error('Received empty file buffer');
                    }

                    downloadedFiles.push({
                        name: fileItem.name,
                        data: arrayBuffer
                    });
                    completed++;
                    console.log(`[GUC CMS] Successfully loaded (${completed}/${total}): ${fileItem.name}`);
                } catch (err) {
                    console.error(`[GUC CMS] Failed to fetch "${fileItem.name}":`, err);
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
            updateProgressModal(100, `❌ Failed to download any files for "${archiveTitle}".`);
            if (statusBtn) {
                statusBtn.innerHTML = '❌ Download Failed';
                setTimeout(() => {
                    statusBtn.innerHTML = originalBtnHtml;
                    statusBtn.classList.remove('busy');
                    statusBtn.disabled = false;
                }, 3500);
            }
            return;
        }

        if (statusBtn) statusBtn.innerHTML = `📦 Zipping (${completed} files)...`;
        updateProgressModal(95, `Building ZIP archive (${completed} files)...`);

        try {
            const zipBytes = buildZipSynchronous(downloadedFiles);
            const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
            const cleanZipName = `${sanitizeFilename(archiveTitle)} - GUC CMS.zip`;
            const blobSizeMb = (zipBlob.size / (1024 * 1024)).toFixed(2);

            console.log(`[GUC CMS] ZIP built successfully! Size: ${blobSizeMb} MB`);

            const blobUrl = triggerDownloadBlob(zipBlob, cleanZipName);

            updateProgressModal(
                100,
                `✅ ZIP ready (${blobSizeMb} MB). Download started!`,
                `<a href="${blobUrl}" download="${cleanZipName}" class="guc-dl-link-btn">💾 Click here if download didn't start</a>`
            );

            if (statusBtn) {
                statusBtn.innerHTML = `✅ Complete! (${blobSizeMb} MB)`;
                statusBtn.classList.remove('busy');
                statusBtn.classList.add('ready');
            }

            closeProgressModal(8000);
        } catch (zipErr) {
            console.error('[GUC CMS] Error building ZIP:', zipErr);
            updateProgressModal(100, `❌ ZIP error: ${zipErr.message}`);
            if (statusBtn) statusBtn.innerHTML = '❌ ZIP Error';
        } finally {
            if (statusBtn) {
                setTimeout(() => {
                    statusBtn.innerHTML = originalBtnHtml;
                    statusBtn.classList.remove('busy');
                    statusBtn.classList.remove('ready');
                    statusBtn.disabled = false;
                }, 6000);
            }
        }
    }

    // =========================================================================
    // FEATURE 3: NON-GLITCHING COLLAPSIBLE DROPDOWN SELECTION MENU
    // =========================================================================

    const detectedWeeksMap = new Map();
    let dropdownContainerEl = null;

    function buildDropdownContainerOnce() {
        if (dropdownContainerEl) return;

        dropdownContainerEl = document.createElement('div');
        dropdownContainerEl.className = 'guc-dropdown-container';

        dropdownContainerEl.innerHTML = `
            <button type="button" class="guc-dropdown-toggle-btn" id="guc-dd-toggle">
                <span>📑 Select Weeks to Download</span>
                <span class="guc-zip-count-badge" id="guc-dd-badge">0 selected (0 files)</span>
                <span class="guc-dropdown-arrow">▼</span>
            </button>
            <div class="guc-dropdown-menu">
                <div class="guc-dd-header">
                    <span class="guc-dd-title" id="guc-dd-header-title">Select Weeks</span>
                    <div class="guc-dd-quick-actions">
                        <button type="button" class="guc-dd-btn-sm" id="guc-dd-select-all">Select All</button>
                        <button type="button" class="guc-dd-btn-sm" id="guc-dd-clear">Clear</button>
                    </div>
                </div>
                <div class="guc-dd-weeks-list" id="guc-dd-list"></div>
                <button type="button" class="guc-dd-download-btn" id="guc-dd-download-btn" disabled>
                    📦 Download Selected as ZIP
                </button>
            </div>
        `;

        const targetContainer = document.querySelector('.container, .container-fluid, #main-content, form') || document.body;
        const firstHeading = document.querySelector(CONFIG.WEEK_HEADING_SELECTOR) || targetContainer.firstChild;

        if (firstHeading && firstHeading.parentNode) {
            firstHeading.parentNode.insertBefore(dropdownContainerEl, firstHeading);
        } else {
            targetContainer.prepend(dropdownContainerEl);
        }

        // Toggle dropdown open/close on click
        const toggleBtn = dropdownContainerEl.querySelector('#guc-dd-toggle');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownContainerEl.classList.toggle('open');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdownContainerEl && !dropdownContainerEl.contains(e.target)) {
                dropdownContainerEl.classList.remove('open');
            }
        });

        // Quick Actions
        dropdownContainerEl.querySelector('#guc-dd-select-all').addEventListener('click', (e) => {
            e.stopPropagation();
            detectedWeeksMap.forEach(w => {
                w.selected = true;
                if (w.onPageCheckbox) w.onPageCheckbox.checked = true;
                if (w.dropdownCheckbox) w.dropdownCheckbox.checked = true;
            });
            updateDropdownCounts();
        });

        dropdownContainerEl.querySelector('#guc-dd-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            detectedWeeksMap.forEach(w => {
                w.selected = false;
                if (w.onPageCheckbox) w.onPageCheckbox.checked = false;
                if (w.dropdownCheckbox) w.dropdownCheckbox.checked = false;
            });
            updateDropdownCounts();
        });

        // Download Action
        dropdownContainerEl.querySelector('#guc-dd-download-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownContainerEl.classList.remove('open');
            downloadSelectedWeeks();
        });
    }

    function syncDropdownItems() {
        if (!detectedWeeksMap.size) return;
        buildDropdownContainerOnce();

        const listEl = dropdownContainerEl.querySelector('#guc-dd-list');
        const headerTitle = dropdownContainerEl.querySelector('#guc-dd-header-title');
        if (headerTitle) headerTitle.textContent = `Select Weeks (${detectedWeeksMap.size} total)`;

        detectedWeeksMap.forEach((week, title) => {
            if (week.dropdownRow && week.dropdownRow.parentNode) {
                // Row already exists, just sync state
                if (week.dropdownCheckbox) {
                    week.dropdownCheckbox.checked = !!week.selected;
                }
                return;
            }

            // Create row once
            const itemRow = document.createElement('div');
            itemRow.className = 'guc-dd-week-item';

            itemRow.innerHTML = `
                <div class="guc-dd-week-left">
                    <input type="checkbox" class="guc-week-checkbox" ${week.selected ? 'checked' : ''}>
                    <span>${week.title}</span>
                </div>
                <span class="guc-dd-week-badge">${week.items.length} files</span>
            `;

            const chk = itemRow.querySelector('input');
            week.dropdownCheckbox = chk;
            week.dropdownRow = itemRow;

            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                week.selected = chk.checked;
                if (week.onPageCheckbox) week.onPageCheckbox.checked = chk.checked;
                updateDropdownCounts();
            });

            itemRow.addEventListener('click', (e) => {
                if (e.target !== chk) {
                    chk.checked = !chk.checked;
                    week.selected = chk.checked;
                    if (week.onPageCheckbox) week.onPageCheckbox.checked = chk.checked;
                    updateDropdownCounts();
                }
            });

            listEl.appendChild(itemRow);
        });

        updateDropdownCounts();
    }

    function updateDropdownCounts() {
        if (!dropdownContainerEl) return;
        const allWeeks = Array.from(detectedWeeksMap.values());
        const selected = allWeeks.filter(w => w.selected);
        const totalFiles = selected.reduce((sum, w) => sum + w.items.length, 0);

        const badge = dropdownContainerEl.querySelector('#guc-dd-badge');
        const dlBtn = dropdownContainerEl.querySelector('#guc-dd-download-btn');

        if (badge) badge.textContent = `${selected.length} selected (${totalFiles} files)`;
        if (dlBtn) {
            dlBtn.disabled = selected.length === 0;
            dlBtn.innerHTML = `📦 Download Selected (${selected.length} Weeks - ${totalFiles} Files) as ZIP`;
        }
    }

    function downloadSelectedWeeks() {
        const selected = Array.from(detectedWeeksMap.values()).filter(w => w.selected);
        if (selected.length === 0) {
            alert('Please select at least one week from the dropdown menu.');
            return;
        }

        const isMultiWeek = selected.length > 1;
        const allFileEntries = [];

        selected.forEach(week => {
            const cleanWeekFolder = sanitizeFilename(week.title);
            const deduplicated = deduplicateFilenames(week.items);

            deduplicated.forEach(item => {
                allFileEntries.push({
                    name: isMultiWeek ? `${cleanWeekFolder}/${item.uniqueFilename}` : item.uniqueFilename,
                    url: item.url
                });
            });
        });

        const pageHeading = document.querySelector('h1, h2, #lblCourseName, .coursename');
        const courseName = pageHeading ? pageHeading.textContent.trim() : 'GUC CMS';
        const archiveName = isMultiWeek
            ? `${courseName} - Selected (${selected.length} Weeks)`
            : selected[0].title;

        const downloadBtn = dropdownContainerEl ? dropdownContainerEl.querySelector('#guc-dd-download-btn') : null;
        executeZipDownloadPipeline(archiveName, allFileEntries, downloadBtn);
    }

    // =========================================================================
    // INJECT UI BUTTONS & CHECKBOXES
    // =========================================================================

    function injectZipButtons() {
        const headings = Array.from(document.querySelectorAll(CONFIG.WEEK_HEADING_SELECTOR)).filter(h => {
            const text = (h.textContent || '').trim();
            return /^week[:\s]/i.test(text) && !h.closest('.card.mb-4');
        });

        headings.forEach((heading, idx) => {
            if (heading.getAttribute('data-guc-zip-bound')) return;

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

                // Get or create unique week entry in Map
                let weekEntry = detectedWeeksMap.get(rawTitle);
                if (!weekEntry) {
                    weekEntry = {
                        title: rawTitle,
                        items: filteredItems,
                        selected: false,
                        onPageCheckbox: null,
                        dropdownCheckbox: null,
                        dropdownRow: null
                    };
                    detectedWeeksMap.set(rawTitle, weekEntry);
                } else {
                    weekEntry.items = filteredItems;
                }

                // 1. Checkbox directly beside heading
                const selectLabel = document.createElement('label');
                selectLabel.className = 'guc-week-select-label';
                selectLabel.title = `Select ${rawTitle} for multi-week batch download`;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'guc-week-checkbox';
                checkbox.checked = !!weekEntry.selected;

                checkbox.addEventListener('change', () => {
                    weekEntry.selected = checkbox.checked;
                    if (weekEntry.dropdownCheckbox) weekEntry.dropdownCheckbox.checked = checkbox.checked;
                    updateDropdownCounts();
                });

                weekEntry.onPageCheckbox = checkbox;
                selectLabel.appendChild(checkbox);
                selectLabel.appendChild(document.createTextNode('Select'));
                heading.appendChild(selectLabel);

                // 2. Single week ZIP button
                const zipBtn = document.createElement('button');
                zipBtn.type = 'button';
                zipBtn.className = 'guc-zip-btn';
                zipBtn.innerHTML = `📦 Download Week ZIP <span class="guc-zip-count-badge">${filteredItems.length}</span>`;
                zipBtn.title = `Download all ${filteredItems.length} files for ${rawTitle} as a ZIP`;

                zipBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const deduplicated = deduplicateFilenames(filteredItems);
                    const entries = deduplicated.map(i => ({ name: i.uniqueFilename, url: i.url }));
                    executeZipDownloadPipeline(rawTitle, entries, zipBtn);
                });

                heading.appendChild(zipBtn);
            }
        });

        // Synchronize dropdown without re-rendering or glitching
        syncDropdownItems();
    }

    // =========================================================================
    // INITIALIZATION & SAFE MUTATION OBSERVER
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

    // Safe Mutation Observer that ignores our own UI mutations
    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const mut of mutations) {
            // Ignore mutations created by our own userscript elements
            if (mut.target && (
                mut.target.closest?.('.guc-dropdown-container') ||
                mut.target.closest?.('.guc-progress-modal') ||
                mut.target.classList?.contains('guc-zip-btn') ||
                mut.target.classList?.contains('guc-week-select-label')
            )) {
                continue;
            }

            if (mut.addedNodes.length > 0) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1 && !node.classList?.contains('guc-dropdown-container') && !node.classList?.contains('guc-progress-modal')) {
                        shouldUpdate = true;
                        break;
                    }
                }
            }
            if (shouldUpdate) break;
        }

        if (shouldUpdate) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                runAll();
            }, 350);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[GUC CMS] Content Renamer & Batch Downloader v1.8.0 initialized.');
})();