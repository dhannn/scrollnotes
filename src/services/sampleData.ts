import { FrameRecord, EncounterSample } from '../types/schema';

/** Escape text for safe embedding in inline SVG <text> nodes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Greedy word-wrap for inline SVG <text>. foreignObject is unreliable when an
 * SVG is rasterised to canvas (needed by OCR + perceptual hashing), so mock
 * body copy is laid out as real <text>/<tspan> lines with a fixed advance.
 */
function wrapTextLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textBlock(
  text: string,
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  fill: string,
  maxChars: number,
  maxLines: number
): string {
  const lines = wrapTextLines(text, maxChars).slice(0, maxLines);
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-weight="400">${tspans}</text>`;
}

function createMockSVG(
  platformName: string,
  platformColor: string,
  authorName: string,
  handle: string,
  bodyText: string,
  tagline: string,
  secondaryAuthor?: string,
  secondaryText?: string,
  accentColor: string = '#06b6d4'
): string {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1440" width="1080" height="1440" style="background:#090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <defs>
      <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#141c2e"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <linearGradient id="mediaGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${platformColor}"/>
        <stop offset="100%" stop-color="${accentColor}"/>
      </linearGradient>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
    </defs>

    <!-- Top Status Bar & Platform Header -->
    <rect x="0" y="0" width="1080" height="90" fill="#0b1120"/>
    <text x="540" y="58" fill="#94a3b8" font-size="28" font-weight="600" text-anchor="middle" letter-spacing="2">DIGITAL FIELD RECORDING • ${platformName.toUpperCase()}</text>

    <!-- Main Content Container Card -->
    <g transform="translate(60, 120)" filter="url(#shadow)">
      <rect width="960" height="${secondaryText ? '760' : '1240'}" rx="28" fill="url(#cardGrad)" stroke="#1e293b" stroke-width="2"/>
      
      <!-- Primary Post Author Header -->
      <circle cx="90" cy="90" r="46" fill="url(#mediaGrad)"/>
      <text x="90" y="102" fill="#ffffff" font-size="34" font-weight="bold" text-anchor="middle">${authorName.charAt(0)}</text>
      
      <text x="160" y="82" fill="#f8fafc" font-size="32" font-weight="700">${authorName}</text>
      <text x="160" y="118" fill="#64748b" font-size="24">${handle} • 4h ago</text>

      <!-- Primary Post Text (real <text> so canvas rasterisation keeps it for OCR) -->
      ${textBlock(bodyText, 120, 300, 42, 28, '#e2e8f0', 46, 6)}

      <!-- Media or Tagline Box -->
      <g transform="translate(60, 420)">
        <rect width="840" height="${secondaryText ? '240' : '580'}" rx="20" fill="#090e1a" stroke="#334155" stroke-width="1.5"/>
        <text x="420" y="${secondaryText ? '130' : '300'}" fill="#f1f5f9" font-size="26" font-weight="600" text-anchor="middle">${tagline}</text>
      </g>
    </g>

    ${secondaryText ? `
    <!-- Secondary UGC Item (Reply / Next Post in Feed) -->
    <g transform="translate(60, 920)" filter="url(#shadow)">
      <rect width="960" height="440" rx="24" fill="#111827" stroke="#374151" stroke-width="1.5"/>
      <circle cx="80" cy="70" r="36" fill="#38bdf8"/>
      <text x="80" y="80" fill="#ffffff" font-size="26" font-weight="bold" text-anchor="middle">${(secondaryAuthor || 'U').charAt(0)}</text>
      <text x="140" y="65" fill="#f3f4f6" font-size="26" font-weight="600">${secondaryAuthor || 'Community Reply'}</text>
      <text x="140" y="95" fill="#9ca3af" font-size="20">Replying to ${handle}</text>

      <!-- real <text> (raster-safe) instead of foreignObject -->
      ${textBlock(secondaryText, 120, 1090, 40, 26, '#d1d5db', 44, 6)}
    </g>
    ` : ''}
  </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

export interface SampleBundle {
  frames: FrameRecord[];
  encounters: EncounterSample[];
}

export function generateFieldworkSampleBatch(): SampleBundle {
  const now = new Date().toISOString();

  const mockConfigs = [
    {
      sampleId: 'ugc-000001',
      frameId: 'frame-001',
      filename: 'rec_session_01_000124.jpg',
      platform: 'x' as const,
      author: 'Astraea Research',
      handle: '@astraea_ai',
      bodyText: 'Just tested the vision-language alignment on multi-modal documents. Notice how zero-shot OCR grounding shifts dramatically when typography has heavy compression artifacts.',
      tagline: 'Visual Field Test — Graph Alignment Matrix',
      platformColor: '#0ea5e9',
      secondaryAuthor: 'Dr. Marcus Vance',
      secondaryText: 'Are you evaluating with token perplexity or direct CER against verified ground truth bounding boxes? We saw significant divergence on 2B weights.',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_000124.jpg', timestampMs: 124000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000001-1',
          role: 'post' as const,
          orderIndex: 0,
          content: 'Just tested the vision-language alignment on multi-modal documents. Notice how zero-shot OCR grounding shifts dramatically when typography has heavy compression artifacts.',
          author: '@astraea_ai',
          mediaDescription: 'Chart diagram showing multimodal alignment error rates under varying compression levels.',
          hasMedia: true,
          hasAuthor: true,
        },
        {
          id: 'item-ugc-000001-2',
          role: 'reply' as const,
          orderIndex: 1,
          content: 'Are you evaluating with token perplexity or direct CER against verified ground truth bounding boxes? We saw significant divergence on 2B weights.',
          author: '@marcus_vance',
          mediaDescription: 'Textual thread reply below the primary post.',
          hasMedia: false,
          hasAuthor: true,
        },
      ],
      status: 'annotated' as const,
    },
    {
      sampleId: 'ugc-000002',
      frameId: 'frame-002',
      filename: 'rec_session_01_000340.jpg',
      platform: 'reddit' as const,
      author: 'u/hyperbolic_tensor',
      handle: 'r/MachineLearning',
      bodyText: 'Has anyone benchmarked small VLMs (2B-8B) on handwritten whiteboard notes vs social media vertical video overlays? The discrepancy in token hallucination is staggering.',
      tagline: 'r/MachineLearning Discussion Thread #891',
      platformColor: '#f97316',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_000340.jpg', timestampMs: 340000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000002-1',
          role: 'post' as const,
          orderIndex: 0,
          content: 'Has anyone benchmarked small VLMs (2B-8B) on handwritten whiteboard notes vs social media vertical video overlays? The discrepancy in token hallucination is staggering.',
          author: 'u/hyperbolic_tensor',
          mediaDescription: 'Reddit community thread screenshot with discussion text.',
          hasMedia: true,
          hasAuthor: true,
        },
      ],
      status: 'pending' as const,
    },
    {
      sampleId: 'ugc-000003',
      frameId: 'frame-003',
      filename: 'rec_session_01_000680.jpg',
      platform: 'instagram' as const,
      author: 'Studio Chromatic',
      handle: '@studio_chromatic',
      bodyText: 'Exploring algorithmic curations in the wild. When the interface layers comments right across the video background, traditional bounding boxes struggle.',
      tagline: 'Field Note #04: Layered UI Artifacts',
      platformColor: '#ec4899',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_000680.jpg', timestampMs: 680000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000003-1',
          role: 'post' as const,
          orderIndex: 0,
          content: '',
          author: '@studio_chromatic',
          mediaDescription: '',
          hasMedia: true,
          hasAuthor: true,
        },
      ],
      status: 'pending' as const,
    },
    {
      sampleId: 'ugc-000004',
      frameId: 'frame-004',
      filename: 'rec_session_01_000920.jpg',
      platform: 'tiktok' as const,
      author: 'DataDrifter',
      handle: '@datadrifter_live',
      bodyText: 'POV: You are building a 200-sample human ground truth benchmark and the scrolling velocity is too fast for keyframe capture.',
      tagline: 'Live Feed Frame Extraction Rate',
      platformColor: '#06b6d4',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_000920.jpg', timestampMs: 920000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000004-1',
          role: 'post' as const,
          orderIndex: 0,
          content: '',
          author: '',
          mediaDescription: '',
          hasMedia: true,
          hasAuthor: false,
        },
      ],
      status: 'pending' as const,
    },
    {
      sampleId: 'ugc-000005',
      frameId: 'frame-005',
      filename: 'rec_session_01_001240.jpg',
      platform: 'youtube' as const,
      author: 'Vision Frontier',
      handle: 'Vision Frontier Community',
      bodyText: 'Community update: We are testing how OCR auxiliary context changes multi-turn reasoning in Qwen3-VL and open weights.',
      tagline: 'Community Poll & Discussion Card',
      platformColor: '#ef4444',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_001240.jpg', timestampMs: 1240000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000005-1',
          role: 'post' as const,
          orderIndex: 0,
          content: '',
          author: '',
          mediaDescription: '',
          hasMedia: true,
          hasAuthor: false,
        },
      ],
      status: 'pending' as const,
    },
    {
      sampleId: 'ugc-000006',
      frameId: 'frame-006',
      filename: 'rec_session_01_001480.jpg',
      platform: 'threads' as const,
      author: 'Elena Rostova',
      handle: '@elena_fieldnotes',
      bodyText: 'Field observation: Ground truth verification must always respect the verbatim textual noise of the author instead of auto-correcting grammar.',
      tagline: 'Fieldwork Principle #12: Verbatim Ground Truth',
      platformColor: '#a855f7',
      provenance: { recordingId: 'rec-2026-field-01', frameFilename: 'rec_session_01_001480.jpg', timestampMs: 1480000, importedAt: now },
      items: [
        {
          id: 'item-ugc-000006-1',
          role: 'post' as const,
          orderIndex: 0,
          content: '',
          author: '',
          mediaDescription: '',
          hasMedia: false,
          hasAuthor: true,
        },
      ],
      status: 'pending' as const,
    },
  ];

  const frames: FrameRecord[] = mockConfigs.map((cfg) => ({
    id: cfg.frameId,
    filename: cfg.filename,
    dataUrl: createMockSVG(
      cfg.platform,
      cfg.platformColor,
      cfg.author,
      cfg.handle,
      cfg.bodyText,
      cfg.tagline,
      cfg.secondaryAuthor,
      cfg.secondaryText
    ),
    mimeType: 'image/svg+xml',
    width: 1080,
    height: 1440,
    importedAt: now,
  }));

  const encounters: EncounterSample[] = mockConfigs.map((cfg) => ({
    sampleId: cfg.sampleId,
    frameId: cfg.frameId,
    platform: cfg.platform,
    items: cfg.items,
    status: cfg.status,
    metadata: {
      ugcType: 'original-post',
      textDensity: cfg.items.length > 1 ? 'high' : 'medium',
      visualDensity: 'medium',
      isFlaggedForReview: false,
    },
    provenance: cfg.provenance,
    createdAt: now,
    updatedAt: now,
  }));

  return { frames, encounters };
}
