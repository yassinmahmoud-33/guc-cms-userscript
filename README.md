# GUC CMS Modern UI & Batch Downloader

A modern Userscript that transforms the standard GUC CMS student course interface into a clean, Notion-inspired workspace equipped with powerful batch downloading capabilities.

---

## 🚀 Features

### 🎨 Modern Notion-Style Theme & Aesthetics

* **Notion-Style Collapsible Toggles**: Sleek arrowhead toggles next to each week header allow you to collapse and expand course content sections dynamically.


* **Card & Button Redesign**: Modernized material cards featuring rounded corners, subtle shadow depth, updated color gradients, and hover transitions.


* **Content Type Badges**: Displays visual badges for content categories (e.g., lecture, tutorial, lab) extracted directly from material titles.


* **Dimmed Rating Controls**: Non-intrusive course element rating controls that stay out of the way until hovered.



### 📦 Batch & Single-Click Downloading

* **Pure JS Synchronous ZIP Engine**: Built-in zero-dependency ZIP generator constructs archives locally without requiring external libraries or server requests.


* **Per-Week ZIP Downloads**: Download all course files for any single week as a ZIP archive directly from the section header.


* **Multi-Week Selection Dropdown**: Select multiple weeks via a dropdown menu and download all selected materials combined into one structured ZIP file.


* **Automatic Subfolder Organization**: Multi-week ZIP archives automatically group files into separate folders named after each week.


* **Smart File Renaming & Deduplication**: Cleans invalid characters, enforces safe length constraints, and appends unique counters `(1)`, `(2)` to duplicate filenames.


* **Dedicated VOD Video Downloader**: Includes dedicated single-click download buttons for embedded or hidden Video-on-Demand (`.mp4`, `.mkv`) files.



### ⚡ Navigation & Master Toolbar

* **Top Sticky Master Toolbar**: Fast-access toolbar pinned near the top of the course page displaying course details and global actions.


* **Global Expand / Collapse**: Instant single-click actions to expand or collapse all week sections on the page simultaneously.


* **Quick-Jump Pill Bar**: Smooth-scrolling pill buttons for rapid navigation directly to any week's section.


* **Batch Selection Utility**: Global **Select All** and **Clear** buttons within the batch selection interface for quick selection management.



### 🛠️ Performance & UX Improvements

* **Non-Blocking Concurrent Fetching**: Processes batch downloads using up to 3 parallel requests with fallback handling to prevent network blocks.


* **Floating Progress Modal**: On-screen status panel displaying real-time progress percentages, active file fetching info, and manual fallback download links.


* **Dynamic DOM Observer**: Automatically detects dynamically loaded content and applies script enhancements without requiring page reloads.



---

## 📥 Installation

### Prerequisites

You need a userscript manager extension installed in your web browser:

* **Tampermonkey** (Recommended for Chrome, Firefox, Edge, Safari, Brave)
* **Violentmonkey**

### Setup Instructions

#### Option 1: Direct Script Installation (Production)

1. Install **Tampermonkey** or your preferred userscript manager.
2. Create a new userscript in your extension dashboard.
3. Paste the contents of `guc_cms.user.js` into the editor.


4. Save the script.
5. Navigate to any GUC CMS course page (`CourseViewStn.aspx`) to start using it.



#### Option 2: Local Development Setup

If you are modifying the script locally, use `loader.user.js` to automatically pull changes from your local disk upon page refresh:

1. Enable **Allow access to file URLs** in your browser extension manager settings for Tampermonkey.
2. Open `loader.user.js` and update the `@require` path to match the local system file location of your `guc_cms.user.js`:


```javascript
// @require      file:///path/to/your/guc_cms.user.js

```


3. Save and install `loader.user.js` in Tampermonkey.



---

## 🌐 Supported URL Patterns

The script targets the following URLs:

* `[https://cms.guc.edu.eg/apps/student/CourseViewStn.aspx](https://cms.guc.edu.eg/apps/student/CourseViewStn.aspx)*`

* `[http://cms.guc.edu.eg/apps/student/CourseViewStn.aspx](http://cms.guc.edu.eg/apps/student/CourseViewStn.aspx)*`


---

## 🛠️ Configuration Options

You can adjust internal parameters at the top of `guc_cms.user.js` inside the `CONFIG` object:

```javascript
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
```[cite: 1]

---

## 📄 License

This project is open-source and released under the MIT License.

```
