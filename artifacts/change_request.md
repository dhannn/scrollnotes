# Change Request: First-Class Multi-UGC Architecture & Adaptive Stack UX

> **Objective:** Redesign the annotation cockpit and data layer to treat Multi-UGC as a first-class structural property of social media feeds (e.g. X/Twitter and Reddit timelines containing multiple visible posts per frame vs. TikTok/Reels containing single posts or comments).

---

## 1. Grounding in Real-World Feed Characteristics

Social media platforms have vastly different visual and textual densities:
- **Text-Dense Feeds (X/Twitter, Reddit, Threads, Facebook):** A single vertical screenshot routinely contains 2 to 4 distinct UGC items (original posts, replies, quotes) visible simultaneously.
- **Media-Dense Feeds (TikTok, Instagram Reels, YouTube Shorts):** Typically 1 primary video/creator per frame, with multi-item scenarios occurring when comments/chat drawers are expanded.

**Design Imperative:** Multi-UGC is **not** a hidden edge case. The interface must support transcribing multiple visible posts in a single frame with zero mouse friction, while keeping single-item media posts crisp and clean.

---

## 2. Multi-UGC Data Model (`src/types/schema.ts`)

```typescript
export interface GroundTruthItem {
  id: string;
  role: 'post' | 'comment' | 'reply' | 'quoted-post' | 'card' | 'standalone';
  orderIndex: number; // 0 = topmost visible post in frame, 1 = second, etc.
  content: string;
  author: string;
  mediaDescription: string;
}
```

- Every `EncounterSample` stores `items: GroundTruthItem[]`.
- Multi-item frames preserve all items in sequence with their spatial/feed role.

---

## 3. UI/UX: The Adaptive Multi-Item Stack

### 3.1 Stacked Item Cards in Annotation Cockpit (`src/components/GroundTruthForm.tsx`)
- **Visible Stack:** Items are rendered as clean, expandable/collapsible item blocks in the ground truth panel.
- **Item Header Bar:** Displays `Item #1: [Role: Post]`, author summary, and a quick remove button if > 1 item.
- **Instant Item Insertion (`Alt+N` or `Ctrl+Shift+Enter`):**
  - Spawns Item #2 immediately below Item #1.
  - Automatically transfers focus to the new item's `Content` textarea.
- **Single-Item Streamlining:** When a frame contains only 1 item (default), it renders cleanly with zero extra chrome.
- **Save & Next (`Ctrl+Enter`):** Saves all items in the frame stack and advances to the next sample in one keystroke.

### 3.2 Gallery & Full-Text Search Reflections
- **Encounter Cards:** Display exact item counts (e.g., `3 UGC Posts` / `1 UGC Post`) and preview badges.
- **Live Search:** Queries across all item contents and authors within each multi-item frame.
- **Platform Distribution:** Accurately reflects total curated UGC items alongside total frames.

---

## 4. Verification & Testing

- Automated test suite (`src/test/verifyMultiUGC.ts`) testing:
  - Multi-item addition, deletion, and spatial sequence ordering.
  - Keyboard-driven multi-item generation.
  - Multi-item search across secondary replies and posts.
  - Schema export compatibility.
