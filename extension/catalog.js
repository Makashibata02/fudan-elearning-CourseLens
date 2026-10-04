/* Add verified Canvas installations here; build generates the matching permissions. */
globalThis.CanvasPreviewCatalog = Object.freeze({
  platforms: Object.freeze([
    { id: 'fudan', name: '复旦 eLearning', origin: 'https://elearning.fudan.edu.cn', adapter: 'canvas' },
  ]),
  formats: Object.freeze([
    { id: 'pdf', labelPattern: /\.pdf\b/i, pathPattern: /\.pdf$/i, viewer: 'viewer.html' },
    { id: 'docx', labelPattern: /\.docx\b/i, pathPattern: /\.docx$/i, viewer: 'viewer.html' },
    { id: 'heic', labelPattern: /\.(?:heic|heif)\b/i, pathPattern: /\.(?:heic|heif)$/i, viewer: 'viewer.html' },
    { id: 'zip', labelPattern: /\.zip\b/i, pathPattern: /\.zip$/i, viewer: 'viewer.html' },
    { id: 'image', labelPattern: /\.(?:png|jpe?g|gif|webp|bmp)\b/i, pathPattern: /\.(?:png|jpe?g|gif|webp|bmp)$/i, viewer: 'viewer.html' },
    { id: 'text', labelPattern: /\.(?:txt|md|csv|tsv|json|log|py|c|cpp|h|java|js|ts|sql|r|tex)\b/i, pathPattern: /\.(?:txt|md|csv|tsv|json|log|py|c|cpp|h|java|js|ts|sql|r|tex)$/i, viewer: 'viewer.html' },
    { id: 'unsupported', labelPattern: /\.(?:doc|docm|xls|xlsx|ppt|pptx|rtf|odt)\b/i, pathPattern: /\.(?:doc|docm|xls|xlsx|ppt|pptx|rtf|odt)$/i, viewer: 'viewer.html' },
  ]),
  readers: Object.freeze([
    { id: 'bundled', label: '内置阅读器（推荐）' },
  ]),
});
