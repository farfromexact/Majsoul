export const overlayStyles = `
#majsoul-helper-overlay {
  position: fixed;
  top: 96px;
  right: 16px;
  z-index: 2147483647;
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 120px);
  color: #e8eaed;
  background: #202124;
  border: 1px solid #3c4043;
  border-radius: 8px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
#majsoul-helper-overlay.mh-collapsed .mh-body { display: none; }
#majsoul-helper-overlay * { box-sizing: border-box; }
.mh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  cursor: move;
  background: #2b2c2f;
  border-bottom: 1px solid #3c4043;
  user-select: none;
}
.mh-title { font-weight: 650; }
.mh-actions { display: flex; gap: 6px; align-items: center; }
.mh-button {
  display: inline-block;
  border: 1px solid #5f6368;
  background: #303134;
  color: #e8eaed;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  text-decoration: none;
}
.mh-button:hover { background: #3c4043; }
.mh-body {
  display: grid;
  gap: 10px;
  padding: 10px;
  overflow: auto;
  max-height: calc(100vh - 170px);
}
.mh-section {
  display: grid;
  gap: 6px;
}
.mh-section-title {
  color: #bdc1c6;
  font-size: 12px;
  font-weight: 650;
}
.mh-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mh-tile {
  min-width: 26px;
  text-align: center;
  padding: 2px 5px;
  color: #202124;
  background: #f1f3f4;
  border-radius: 4px;
  font-weight: 650;
}
.mh-input {
  width: 100%;
  border: 1px solid #5f6368;
  border-radius: 6px;
  padding: 6px 8px;
  color: #e8eaed;
  background: #171717;
}
.mh-manual-input {
  flex: 1 1 220px;
  width: auto;
  min-width: 0;
}
.mh-warning {
  color: #fdd663;
  background: rgba(253, 214, 99, 0.12);
  border: 1px solid rgba(253, 214, 99, 0.35);
  padding: 6px 8px;
  border-radius: 6px;
}
.mh-candidate {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid #3c4043;
}
.mh-seat-grid {
  display: grid;
  gap: 8px;
}
.mh-seat {
  display: grid;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid #3c4043;
}
.mh-seat-head {
  color: #e8eaed;
  font-weight: 650;
}
.mh-muted { color: #9aa0a6; }
.mh-code {
  width: 100%;
  min-height: 130px;
  white-space: pre-wrap;
  overflow: auto;
  padding: 8px;
  color: #d2e3fc;
  background: #171717;
  border: 1px solid #3c4043;
  border-radius: 6px;
}
`;
