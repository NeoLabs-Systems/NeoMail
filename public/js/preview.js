/* =====================================================
   MailNeo – File Preview
   Images, PDFs shown inline; others trigger download
   ===================================================== */

const PREVIEWABLE_IMAGE = new Set(['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']);
const PREVIEWABLE_PDF   = new Set(['application/pdf']);

function canPreview(contentType, filename) {
  if (PREVIEWABLE_IMAGE.has(contentType)) return 'image';
  if (PREVIEWABLE_PDF.has(contentType))   return 'pdf';
  // Fallback: check file extension
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(filename || '')) return 'image';
  if (/\.pdf$/i.test(filename || ''))                       return 'pdf';
  return null;
}

function openPreview(emailId, attId, filename, contentType) {
  const kind = canPreview(contentType, filename);
  if (!kind) {
    // Not previewable – just download
    const a = document.createElement('a');
    a.href = `/api/emails/${emailId}/attachment/${attId}`;
    a.download = filename || 'attachment';
    a.click();
    return;
  }

  const url  = `/api/emails/${emailId}/attachment/${attId}`;
  const safe = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const overlay = document.getElementById('preview-overlay');
  overlay.innerHTML = `
    <div class="preview-modal">
      <div class="preview-header">
        <span class="preview-filename">${safe(filename)}</span>
        <div class="preview-header-actions">
          <a href="${url}" download="${safe(filename)}" class="icon-btn" title="Download" style="text-decoration:none;font-size:16px">⬇</a>
          <button class="icon-btn" id="preview-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="preview-body">
        ${kind === 'image'
          ? `<img src="${url}" alt="${safe(filename)}" class="preview-img">`
          : `<iframe src="${url}" class="preview-pdf" title="${safe(filename)}"></iframe>`
        }
      </div>
    </div>
  `;

  overlay.style.display = 'flex';

  overlay.querySelector('#preview-close-btn').addEventListener('click', closePreview);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
  document.addEventListener('keydown', handlePreviewKey, { once: true });
}

function closePreview() {
  const overlay = document.getElementById('preview-overlay');
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  document.removeEventListener('keydown', handlePreviewKey);
}

function handlePreviewKey(e) {
  if (e.key === 'Escape') closePreview();
}

// Expose globally so attachment chips in app.js can use it
window.openPreview = openPreview;
