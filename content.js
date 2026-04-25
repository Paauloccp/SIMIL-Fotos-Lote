(() => {
  try {
    const allowedPaths = [
      '/pages/laudo/construcao/cadastrarlaudo.xhtml',
      '/pages/laudo/cadastrarlaudo.xhtml'
    ];
    if (!allowedPaths.some((path) => location.href.includes(path))) return;
    if (window.__SIMIL_FOTOS_LOTE_INSTALLED__) return;
    window.__SIMIL_FOTOS_LOTE_INSTALLED__ = true;

    const EXT = 'similFotosLote';
    const BTN_ID = `${EXT}Btn`;
    const PICKER_ID = `${EXT}Picker`;
    const DOC_BTN_ID = `${EXT}DocsBtn`;
    const DOC_PICKER_ID = `${EXT}DocsPicker`;
    const TOAST_ID = `${EXT}Toast`;
    const MODAL_ID = `${EXT}Modal`;
    const STYLE_ID = `${EXT}Style`;
    const DB_NAME = `${EXT}Db`;
    const DB_VERSION = 1;
    const STATE_KEY = 'activeBatch';
    const DOC_STATE_KEY = 'activeDocsBatch';
    const MAX_FOTOS = 12;

    let processing = false;
    let docsProcessing = false;
    let resumeTimer = null;
    let docsResumeTimer = null;
    let dbPromise = null;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const normalize = (s) =>
      String(s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const cleanFileName = (name) =>
      String(name || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const dispatchValueEvents = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    const setNativeInputValue = (input, value) => {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
    };

    const clickLikeUser = (el) => {
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.click();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    };

    const waitFor = async (predicate, timeout = 5000, interval = 150) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const result = predicate();
        if (result) return result;
        await sleep(interval);
      }
      return null;
    };

    const toast = (msg, ms = 3800) => {
      let t = document.getElementById(TOAST_ID);
      if (!t) {
        t = document.createElement('div');
        t.id = TOAST_ID;
        t.style.cssText = `
          position: fixed;
          right: 16px;
          bottom: 210px;
          z-index: 2147483647;
          background: rgba(0,0,0,.84);
          color: #fff;
          padding: 10px 12px;
          border-radius: 10px;
          font: 13px Arial, sans-serif;
          max-width: 440px;
          white-space: pre-line;
          box-shadow: 0 8px 24px rgba(0,0,0,.18);
        `;
        (document.body || document.documentElement).appendChild(t);
      }
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(window.__similFotosLoteToastTimer);
      window.__similFotosLoteToastTimer = setTimeout(() => {
        t.style.display = 'none';
      }, ms);
    };

    const openDb = () => {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('state')) {
            db.createObjectStore('state', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return dbPromise;
    };

    const txDone = (tx) =>
      new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

    const dbGet = async (storeName, key) => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    };

    const dbPut = async (storeName, value) => {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      await txDone(tx);
    };

    const saveBatchByKey = (key, batch) => dbPut('state', { key, batch });

    const loadBatchByKey = async (key) => {
      const record = await dbGet('state', key);
      return record?.batch || null;
    };

    const saveBatch = (batch) => saveBatchByKey(STATE_KEY, batch);

    const loadBatch = async () => {
      return loadBatchByKey(STATE_KEY);
    };

    const saveDocsBatch = (batch) => saveBatchByKey(DOC_STATE_KEY, batch);

    const loadDocsBatch = async () => {
      return loadBatchByKey(DOC_STATE_KEY);
    };

    const clearAllBatches = async () => {
      const db = await openDb();
      const tx = db.transaction(['state', 'files'], 'readwrite');
      tx.objectStore('state').delete(STATE_KEY);
      tx.objectStore('state').delete(DOC_STATE_KEY);
      tx.objectStore('files').clear();
      await txDone(tx);
    };

    const clearBatch = () => clearAllBatches();

    const clearDocsBatch = () => clearAllBatches();

    const storeFiles = async (filesById) => {
      const db = await openDb();
      const tx = db.transaction('files', 'readwrite');
      filesById.forEach((file, id) => {
        tx.objectStore('files').put({
          id,
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified
        });
      });
      await txDone(tx);
    };

    const getFileForItem = async (item) => {
      const record = await dbGet('files', item.id);
      if (!record?.blob) throw new Error(`Arquivo temporario nao encontrado: ${item.name}`);
      return new File([record.blob], record.name || item.name, {
        type: record.type || item.type || 'image/jpeg',
        lastModified: record.lastModified || item.lastModified || Date.now()
      });
    };

    const findPhotoPanel = () => {
      const direct = document.getElementById('formCadastro-tab-foto');
      if (direct) return direct;

      const candidates = [
        ...document.querySelectorAll('[id*="tab-foto"], [id*="tabFoto"], .ui-tabs-panel, fieldset, form')
      ];

      const byText = candidates.find(el => {
        const txt = normalize(el.textContent);
        return txt.includes('referencia foto') && txt.includes('descricao foto') && txt.includes('foto');
      });

      return byText || null;
    };

    const findDocsPanel = () => {
      const direct = document.getElementById('formCadastro-tab-documento');
      if (direct) return direct;

      const candidates = [
        ...document.querySelectorAll('[id*="tab-documento"], [id*="tabDocumento"], .ui-tabs-panel, fieldset, form')
      ];

      const byText = candidates.find(el => {
        const txt = normalize(el.textContent);
        return (
          txt.includes('relacao geral') &&
          txt.includes('anexo') &&
          (txt.includes('relacionar') || txt.includes('descricao documento'))
        );
      });

      return byText || null;
    };

    const getTextNodes = (root, text) => {
      const expected = normalize(text);
      return [...root.querySelectorAll('label, span, div, td, th, legend, strong')]
        .filter(el => normalize(el.textContent) === expected);
    };

    const findFieldByLabel = (root, label, selector) => {
      const nodes = getTextNodes(root, label);
      for (const node of nodes) {
        const scopes = [
          node,
          node.closest('.control-group'),
          node.closest('[class*="span"]'),
          node.parentElement,
          node.parentElement?.parentElement,
          node.parentElement?.parentElement?.parentElement,
          node.closest('tr'),
          node.closest('fieldset')
        ].filter(Boolean);

        for (const scope of scopes) {
          const fields = [...scope.querySelectorAll(selector)]
            .filter(el => !el.id?.startsWith(EXT) && !el.disabled && isVisible(el));
          if (fields.length) return fields[0];
        }
      }

      return null;
    };

    const findReferenceSelect = (root = findPhotoPanel()) => {
      if (!root) return null;
      return findFieldByLabel(root, 'Referencia Foto', 'select')
        || [...root.querySelectorAll('select')].find(el => !el.disabled && isVisible(el))
        || null;
    };

    const findDescriptionInput = (root = findPhotoPanel()) => {
      if (!root) return null;
      return findFieldByLabel(root, 'Descricao Foto', 'input[type="text"], input:not([type]), textarea')
        || [...root.querySelectorAll('input[type="text"], input:not([type]), textarea')]
          .find(el => !el.id?.startsWith(EXT) && !el.disabled && !el.readOnly && isVisible(el))
        || null;
    };

    const findFileInput = (root = findPhotoPanel()) => {
      if (!root) return null;
      const byLabel = findFieldByLabel(root, 'Foto', 'input[type="file"]');
      if (byLabel) return byLabel;
      return [...root.querySelectorAll('input[type="file"]')]
        .find(el => !el.id?.startsWith(EXT) && !el.disabled)
        || null;
    };

    const findDocTypeSelect = (root = findDocsPanel()) => {
      if (!root) return null;
      return findFieldByLabel(root, 'Relacao Geral', 'select')
        || [...root.querySelectorAll('select')]
          .filter(el => !el.disabled && isVisible(el))
          .sort((a, b) => (b.size || 0) - (a.size || 0))[0]
        || null;
    };

    const findDocFileInput = (root = findDocsPanel()) => {
      if (!root) return null;
      const byLabel = findFieldByLabel(root, 'Anexo', 'input[type="file"]');
      if (byLabel) return byLabel;
      return [...root.querySelectorAll('input[type="file"]')]
        .find(el => !el.id?.startsWith(EXT) && !el.disabled)
        || null;
    };

    const looksLikeAddControl = (el) => {
      const txt = normalize(el.textContent || el.value || el.getAttribute('title') || '');
      const cls = String(el.className || '');
      const role = el.getAttribute('role') || '';
      const tag = el.tagName;
      return (
        (txt === 'adicionar' || txt === 'adicionar foto') &&
        (
          ['BUTTON', 'A', 'SPAN', 'INPUT'].includes(tag) ||
          role === 'button' ||
          cls.includes('btn') ||
          cls.includes('commandlink')
        )
      );
    };

    const findAddButton = (root = findPhotoPanel()) => {
      if (!root) return null;
      return [...root.querySelectorAll('button, a, span, input[type="button"], input[type="submit"]')]
        .filter(el => !el.id?.startsWith(EXT) && isVisible(el) && looksLikeAddControl(el))
        .sort((a, b) => {
          const aid = /adicionar/i.test(a.id || '') ? -1 : 0;
          const bid = /adicionar/i.test(b.id || '') ? -1 : 0;
          return aid - bid;
        })[0] || null;
    };

    const findRelateButton = (root = findDocsPanel()) => {
      if (!root) return null;
      return [...root.querySelectorAll('button, a, span, input[type="button"], input[type="submit"]')]
        .filter(el => {
          if (el.id?.startsWith(EXT) || !isVisible(el)) return false;
          const txt = normalize(el.textContent || el.value || el.getAttribute('title') || '');
          return txt === 'relacionar';
        })[0] || null;
    };

    const isDisabledButton = (el) =>
      !el ||
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      /\b(ui-state-disabled|disabled)\b/.test(String(el.className || ''));

    const readReferenceOptions = () => {
      const select = findReferenceSelect();
      if (!select) return [];
      return [...select.options]
        .map(opt => ({
          value: opt.value,
          text: (opt.textContent || '').trim()
        }))
        .filter(opt => opt.value && normalize(opt.text) && !normalize(opt.text).includes('selecione'));
    };

    const readDocTypeOptions = () => {
      const select = findDocTypeSelect();
      if (!select) return [];
      return [...select.options]
        .map(opt => ({
          value: opt.value,
          text: (opt.textContent || '').trim()
        }))
        .filter(opt => opt.value && normalize(opt.text) && !normalize(opt.text).includes('selecione'));
    };

    const needsDocComplement = (text) => {
      const normalized = normalize(text);
      return normalized.includes('outros') && normalized.includes('inform') && normalized.includes('complem');
    };

    const countExistingPhotos = () => {
      const root = findPhotoPanel();
      if (!root) return 0;
      const images = [...root.querySelectorAll('img')]
        .filter(img => !img.closest(`#${MODAL_ID}`))
        .filter(img => isVisible(img))
        .filter(img => img.getBoundingClientRect().width >= 45 && img.getBoundingClientRect().height >= 35);
      return images.length;
    };

    const ensureStyles = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #${MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          background: rgba(18, 28, 38, .42);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
        }

        #${MODAL_ID} * {
          box-sizing: border-box;
        }

        .${EXT}-dialog {
          width: min(1080px, 96vw);
          max-height: 92vh;
          background: #fff;
          color: #21313f;
          border-radius: 8px;
          box-shadow: 0 18px 48px rgba(0,0,0,.26);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .${EXT}-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px;
          background: #0d6e8f;
          color: #fff;
        }

        .${EXT}-header h2 {
          margin: 0;
          font-size: 17px;
          line-height: 1.25;
          font-weight: 700;
        }

        .${EXT}-header small {
          display: block;
          margin-top: 2px;
          font-size: 12px;
          opacity: .9;
        }

        .${EXT}-body {
          padding: 14px 16px;
          overflow: auto;
        }

        .${EXT}-toolbar {
          display: grid;
          grid-template-columns: minmax(190px, 280px) auto 1fr;
          gap: 8px;
          align-items: end;
          margin-bottom: 12px;
        }

        .${EXT}-toolbar label,
        .${EXT}-field label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          font-weight: 700;
          color: #475866;
        }

        .${EXT}-toolbar select,
        .${EXT}-field select,
        .${EXT}-field input {
          width: 100%;
          height: 34px;
          border: 1px solid #becad2;
          border-radius: 5px;
          padding: 6px 8px;
          font: 13px Arial, sans-serif;
          background: #fff;
        }

        .${EXT}-items {
          display: grid;
          gap: 8px;
        }

        .${EXT}-item {
          display: grid;
          grid-template-columns: 96px minmax(150px, 1fr) minmax(180px, 250px) minmax(180px, 280px) 92px;
          gap: 10px;
          align-items: center;
          border: 1px solid #d7e0e5;
          border-radius: 7px;
          padding: 8px;
          background: #f8fafb;
        }

        .${EXT}-thumb {
          width: 96px;
          height: 70px;
          object-fit: cover;
          border-radius: 5px;
          background: #dce5ea;
        }

        .${EXT}-name {
          font-size: 13px;
          font-weight: 700;
          word-break: break-word;
        }

        .${EXT}-meta {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          font-weight: 400;
          color: #657581;
        }

        .${EXT}-reorder {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
        }

        .${EXT}-moveBtn {
          border: 1px solid #c7d3da;
          border-radius: 5px;
          background: #fff;
          color: #2f4352;
          cursor: pointer;
          font: 700 11px Arial, sans-serif;
          padding: 4px 6px;
          min-height: 24px;
        }

        .${EXT}-moveBtn:disabled {
          opacity: .45;
          cursor: not-allowed;
        }

        .${EXT}-status {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-height: 28px;
          padding: 5px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          background: #e8eef2;
          color: #435461;
          text-align: center;
        }

        .${EXT}-status.done {
          background: #d7f0df;
          color: #176b36;
        }

        .${EXT}-status.submitting {
          background: #fff0ce;
          color: #805500;
        }

        .${EXT}-status.error {
          background: #f7d7d7;
          color: #8c1d1d;
        }

        .${EXT}-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-top: 1px solid #d7e0e5;
          background: #f4f7f9;
        }

        .${EXT}-progressWrap {
          flex: 1;
          min-width: 160px;
        }

        .${EXT}-progressText {
          margin-bottom: 5px;
          font-size: 12px;
          color: #566673;
        }

        .${EXT}-progress {
          height: 8px;
          border-radius: 999px;
          overflow: hidden;
          background: #dce5ea;
        }

        .${EXT}-progress span {
          display: block;
          height: 100%;
          width: var(--pct, 0%);
          background: #198754;
        }

        .${EXT}-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .${EXT}-btn {
          border: 0;
          border-radius: 7px;
          padding: 9px 12px;
          font: 700 13px Arial, sans-serif;
          cursor: pointer;
          background: #e3e9ed;
          color: #21313f;
        }

        .${EXT}-btn.primary {
          background: #198754;
          color: #fff;
        }

        .${EXT}-btn.orange {
          background: #f39201;
          color: #fff;
        }

        .${EXT}-btn.danger {
          background: #c0392b;
          color: #fff;
        }

        .${EXT}-btn:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .${EXT}-notice {
          margin: 0 0 12px;
          padding: 9px 10px;
          border-radius: 6px;
          background: #e9f5fb;
          color: #244b61;
          font-size: 13px;
          line-height: 1.35;
        }

        .${EXT}-errorText {
          margin-top: 4px;
          color: #9b1c1c;
          font-size: 12px;
        }

        @media (max-width: 840px) {
          .${EXT}-toolbar {
            grid-template-columns: 1fr;
          }

          .${EXT}-item {
            grid-template-columns: 80px 1fr;
          }

          .${EXT}-thumb {
            width: 80px;
            height: 62px;
          }

          .${EXT}-field,
          .${EXT}-status {
            grid-column: 1 / -1;
          }
        }
      `;
      document.documentElement.appendChild(style);
    };

    const createButton = (text, className = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${EXT}-btn ${className}`.trim();
      btn.textContent = text;
      return btn;
    };

    const moveItem = (items, fromIndex, toIndex) => {
      if (fromIndex === toIndex) return false;
      if (fromIndex < 0 || fromIndex >= items.length) return false;
      if (toIndex < 0 || toIndex >= items.length) return false;

      const [item] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, item);
      return true;
    };

    const closeModal = () => {
      document.getElementById(MODAL_ID)?.remove();
    };

    const buildReferenceSelect = (options, selectedValue, disabled = false) => {
      const select = document.createElement('select');
      select.disabled = disabled;

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Selecione...';
      select.appendChild(placeholder);

      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        if (opt.value === selectedValue) option.selected = true;
        select.appendChild(option);
      });

      return select;
    };

    const statusLabel = (status) => {
      if (status === 'done') return 'Anexada';
      if (status === 'submitting') return 'Enviando';
      if (status === 'error') return 'Erro';
      return 'Pendente';
    };

    const docStatusLabel = (status) => {
      if (status === 'done') return 'Relacionado';
      if (status === 'submitting') return 'Relacionando';
      if (status === 'error') return 'Erro';
      return 'Pendente';
    };

    const getProgress = (batch) => {
      const total = batch.items.length;
      const done = batch.items.filter(item => item.status === 'done').length;
      return {
        done,
        total,
        pct: total ? Math.round((done / total) * 100) : 0
      };
    };

    const createBatchDialog = (batch, subtitle, title = 'Anexar fotos em lote') => {
      ensureStyles();
      closeModal();

      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;

      const dialog = document.createElement('div');
      dialog.className = `${EXT}-dialog`;

      const header = document.createElement('div');
      header.className = `${EXT}-header`;
      header.innerHTML = `
        <div>
          <h2>${title}</h2>
          <small>${subtitle || ''}</small>
        </div>
      `;

      const close = createButton('Fechar');
      close.addEventListener('click', closeModal);
      header.appendChild(close);

      const body = document.createElement('div');
      body.className = `${EXT}-body`;

      const footer = document.createElement('div');
      footer.className = `${EXT}-footer`;

      dialog.appendChild(header);
      dialog.appendChild(body);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);
      (document.body || document.documentElement).appendChild(overlay);

      return { overlay, body, footer };
    };

    const renderDraftModal = (batch, filesById, referenceOptions) => {
      const { body, footer } = createBatchDialog(
        batch,
        `${batch.items.length} foto(s) selecionada(s)`
      );

      const notice = document.createElement('p');
      notice.className = `${EXT}-notice`;
      notice.textContent = 'Organize as fotos na ordem exigida pela CAIXA, preencha a referencia e a descricao. Depois a extensao vai anexar uma foto por vez usando o botao Adicionar do SIMIL.';
      body.appendChild(notice);

      const toolbar = document.createElement('div');
      toolbar.className = `${EXT}-toolbar`;

      const allRefWrap = document.createElement('div');
      allRefWrap.className = `${EXT}-field`;
      allRefWrap.innerHTML = '<label>Referencia para todas</label>';
      const allRef = buildReferenceSelect(referenceOptions, '');
      allRefWrap.appendChild(allRef);
      toolbar.appendChild(allRefWrap);

      const applyRef = createButton('Aplicar', 'orange');
      applyRef.addEventListener('click', () => {
        const value = allRef.value;
        const text = allRef.selectedOptions[0]?.textContent?.trim() || '';
        if (!value) return;
        batch.items.forEach(item => {
          item.referenceValue = value;
          item.referenceText = text;
        });
        renderDraftModal(batch, filesById, referenceOptions);
      });
      toolbar.appendChild(applyRef);

      const namesBtn = createButton('Usar nome dos arquivos');
      namesBtn.addEventListener('click', () => {
        batch.items.forEach(item => {
          if (!item.description) item.description = cleanFileName(item.name);
        });
        renderDraftModal(batch, filesById, referenceOptions);
      });
      toolbar.appendChild(namesBtn);

      body.appendChild(toolbar);

      const items = document.createElement('div');
      items.className = `${EXT}-items`;

      batch.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `${EXT}-item`;

        const img = document.createElement('img');
        img.className = `${EXT}-thumb`;
        img.alt = item.name;
        img.src = item.previewUrl || URL.createObjectURL(filesById.get(item.id));
        item.previewUrl = img.src;
        row.appendChild(img);

        const name = document.createElement('div');
        name.className = `${EXT}-name`;
        name.textContent = `${index + 1}. ${item.name}`;
        const meta = document.createElement('span');
        meta.className = `${EXT}-meta`;
        meta.textContent = `${Math.max(1, Math.round(item.size / 1024))} KB`;
        name.appendChild(meta);

        const reorder = document.createElement('div');
        reorder.className = `${EXT}-reorder`;

        const addMoveButton = (text, targetIndex) => {
          const moveBtn = document.createElement('button');
          moveBtn.type = 'button';
          moveBtn.className = `${EXT}-moveBtn`;
          moveBtn.textContent = text;
          moveBtn.disabled = targetIndex < 0 || targetIndex >= batch.items.length || targetIndex === index;
          moveBtn.addEventListener('click', () => {
            if (moveItem(batch.items, index, targetIndex)) {
              renderDraftModal(batch, filesById, referenceOptions);
            }
          });
          reorder.appendChild(moveBtn);
        };

        addMoveButton('Primeira', 0);
        addMoveButton('Subir', index - 1);
        addMoveButton('Descer', index + 1);
        addMoveButton('Ultima', batch.items.length - 1);
        name.appendChild(reorder);
        row.appendChild(name);

        const refWrap = document.createElement('div');
        refWrap.className = `${EXT}-field`;
        refWrap.innerHTML = '<label>Referencia</label>';
        const refSelect = buildReferenceSelect(referenceOptions, item.referenceValue);
        refSelect.addEventListener('change', () => {
          item.referenceValue = refSelect.value;
          item.referenceText = refSelect.selectedOptions[0]?.textContent?.trim() || '';
        });
        refWrap.appendChild(refSelect);
        row.appendChild(refWrap);

        const descWrap = document.createElement('div');
        descWrap.className = `${EXT}-field`;
        descWrap.innerHTML = '<label>Descricao</label>';
        const desc = document.createElement('input');
        desc.type = 'text';
        desc.value = item.description || '';
        desc.placeholder = 'Ex.: fachada, terreno, garagem';
        desc.addEventListener('input', () => {
          item.description = desc.value.trim();
        });
        descWrap.appendChild(desc);
        row.appendChild(descWrap);

        const status = document.createElement('span');
        status.className = `${EXT}-status`;
        status.textContent = 'Pendente';
        row.appendChild(status);

        items.appendChild(row);
      });

      body.appendChild(items);

      const progress = getProgress(batch);
      const progressWrap = document.createElement('div');
      progressWrap.className = `${EXT}-progressWrap`;
      progressWrap.innerHTML = `
        <div class="${EXT}-progressText">Pronto para enviar ${progress.total} foto(s).</div>
        <div class="${EXT}-progress"><span style="--pct: 0%"></span></div>
      `;

      const actions = document.createElement('div');
      actions.className = `${EXT}-actions`;

      const cancel = createButton('Cancelar');
      cancel.addEventListener('click', closeModal);

      const start = createButton('Enviar fotos', 'primary');
      start.addEventListener('click', async () => {
        const missingRef = batch.items.filter(item => !item.referenceValue);
        if (missingRef.length) {
          toast(`Escolha a referencia de ${missingRef.length} foto(s).`);
          return;
        }

        const missingDesc = batch.items.filter(item => !item.description);
        if (missingDesc.length && !confirm(`${missingDesc.length} foto(s) estao sem descricao. Deseja enviar mesmo assim?`)) {
          return;
        }

        start.disabled = true;
        cancel.disabled = true;

        batch.running = true;
        batch.startedAt = Date.now();
        batch.items.forEach(item => {
          item.status = 'pending';
          item.error = null;
        });

        try {
          await clearBatch();
          await storeFiles(filesById);
          await saveBatch(stripPreviewUrls(batch));
          renderSavedBatchModal(stripPreviewUrls(batch));
          scheduleResume(300);
        } catch (err) {
          console.error('[SIMIL-FOTOS-LOTE] erro ao salvar lote:', err);
          start.disabled = false;
          cancel.disabled = false;
          toast(`Erro ao preparar as fotos: ${err.message || err}`);
        }
      });

      actions.appendChild(cancel);
      actions.appendChild(start);
      footer.appendChild(progressWrap);
      footer.appendChild(actions);
    };

    const stripPreviewUrls = (batch) => ({
      ...batch,
      items: batch.items.map(item => {
        const { previewUrl, ...rest } = item;
        return rest;
      })
    });

    const renderSavedBatchModal = (batch) => {
      const progress = getProgress(batch);
      const subtitle = batch.running
        ? `Enviando ${progress.done}/${progress.total}`
        : `Fila pausada: ${progress.done}/${progress.total}`;
      const { body, footer } = createBatchDialog(batch, subtitle);

      const notice = document.createElement('p');
      notice.className = `${EXT}-notice`;
      notice.textContent = batch.running
        ? 'Mantenha a aba Fotos aberta. Se o SIMIL recarregar a pagina, a extensao continua do proximo item.'
        : 'A fila esta pausada. Voce pode retomar ou limpar os arquivos temporarios.';
      body.appendChild(notice);

      const items = document.createElement('div');
      items.className = `${EXT}-items`;

      batch.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `${EXT}-item`;

        const thumb = document.createElement('div');
        thumb.className = `${EXT}-thumb`;
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
        thumb.style.color = '#60717d';
        thumb.style.font = '700 12px Arial, sans-serif';
        thumb.textContent = 'Foto';
        row.appendChild(thumb);

        const name = document.createElement('div');
        name.className = `${EXT}-name`;
        name.textContent = `${index + 1}. ${item.name}`;
        const meta = document.createElement('span');
        meta.className = `${EXT}-meta`;
        meta.textContent = `${item.referenceText || 'Sem referencia'} - ${item.description || 'Sem descricao'}`;
        name.appendChild(meta);
        if (item.error) {
          const err = document.createElement('div');
          err.className = `${EXT}-errorText`;
          err.textContent = item.error;
          name.appendChild(err);
        }
        row.appendChild(name);

        const refWrap = document.createElement('div');
        refWrap.className = `${EXT}-field`;
        refWrap.innerHTML = '<label>Referencia</label>';
        const ref = document.createElement('input');
        ref.type = 'text';
        ref.value = item.referenceText || '';
        ref.disabled = true;
        refWrap.appendChild(ref);
        row.appendChild(refWrap);

        const descWrap = document.createElement('div');
        descWrap.className = `${EXT}-field`;
        descWrap.innerHTML = '<label>Descricao</label>';
        const desc = document.createElement('input');
        desc.type = 'text';
        desc.value = item.description || '';
        desc.disabled = true;
        descWrap.appendChild(desc);
        row.appendChild(descWrap);

        const status = document.createElement('span');
        status.className = `${EXT}-status ${item.status || 'pending'}`;
        status.textContent = statusLabel(item.status);
        row.appendChild(status);

        items.appendChild(row);
      });

      body.appendChild(items);

      const progressWrap = document.createElement('div');
      progressWrap.className = `${EXT}-progressWrap`;
      progressWrap.innerHTML = `
        <div class="${EXT}-progressText">${progress.done}/${progress.total} foto(s) anexada(s).</div>
        <div class="${EXT}-progress"><span style="--pct: ${progress.pct}%"></span></div>
      `;

      const actions = document.createElement('div');
      actions.className = `${EXT}-actions`;

      if (!batch.running && batch.items.some(item => item.status !== 'done')) {
        const resume = createButton('Retomar', 'primary');
        resume.addEventListener('click', async () => {
          batch.running = true;
          batch.items.forEach(item => {
            if (item.status === 'error') {
              item.status = 'pending';
              item.error = null;
            }
          });
          await saveBatch(batch);
          renderSavedBatchModal(batch);
          scheduleResume(300);
        });
        actions.appendChild(resume);
      }

      if (batch.running) {
        const continueBtn = createButton('Continuar agora', 'primary');
        continueBtn.addEventListener('click', () => scheduleResume(100));
        actions.appendChild(continueBtn);
      }

      const clear = createButton('Limpar fila', 'danger');
      clear.addEventListener('click', async () => {
        if (!confirm('Limpar a fila temporaria de fotos desta extensao?')) return;
        await clearBatch();
        closeModal();
        toast('Fila temporaria limpa.');
      });
      actions.appendChild(clear);

      footer.appendChild(progressWrap);
      footer.appendChild(actions);
    };

    const renderDocsDraftModal = (batch, filesById, docOptions) => {
      const { body, footer } = createBatchDialog(
        batch,
        `${batch.items.length} documento(s) selecionado(s)`,
        'Relacionar documentos em lote'
      );

      const notice = document.createElement('p');
      notice.className = `${EXT}-notice`;
      notice.textContent = 'Organize os documentos, escolha o tipo de cada anexo e envie. O campo Descricao do tipo so e usado quando o tipo for Outros, Vide Inform. Complem.';
      body.appendChild(notice);

      const toolbar = document.createElement('div');
      toolbar.className = `${EXT}-toolbar`;

      const allTypeWrap = document.createElement('div');
      allTypeWrap.className = `${EXT}-field`;
      allTypeWrap.innerHTML = '<label>Tipo para todos</label>';
      const allType = buildReferenceSelect(docOptions, '');
      allTypeWrap.appendChild(allType);
      toolbar.appendChild(allTypeWrap);

      const applyType = createButton('Aplicar', 'orange');
      applyType.addEventListener('click', () => {
        const value = allType.value;
        const text = allType.selectedOptions[0]?.textContent?.trim() || '';
        if (!value) return;
        batch.items.forEach(item => {
          item.documentValue = value;
          item.documentText = text;
          if (!needsDocComplement(text)) item.complement = '';
        });
        renderDocsDraftModal(batch, filesById, docOptions);
      });
      toolbar.appendChild(applyType);

      body.appendChild(toolbar);

      const items = document.createElement('div');
      items.className = `${EXT}-items`;

      batch.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `${EXT}-item`;

        const icon = document.createElement('div');
        icon.className = `${EXT}-thumb`;
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.color = '#60717d';
        icon.style.font = '700 12px Arial, sans-serif';
        icon.textContent = 'DOC';
        row.appendChild(icon);

        const name = document.createElement('div');
        name.className = `${EXT}-name`;
        name.textContent = `${index + 1}. ${item.name}`;
        const meta = document.createElement('span');
        meta.className = `${EXT}-meta`;
        meta.textContent = `${Math.max(1, Math.round(item.size / 1024))} KB`;
        name.appendChild(meta);

        const reorder = document.createElement('div');
        reorder.className = `${EXT}-reorder`;

        const addMoveButton = (text, targetIndex) => {
          const moveBtn = document.createElement('button');
          moveBtn.type = 'button';
          moveBtn.className = `${EXT}-moveBtn`;
          moveBtn.textContent = text;
          moveBtn.disabled = targetIndex < 0 || targetIndex >= batch.items.length || targetIndex === index;
          moveBtn.addEventListener('click', () => {
            if (moveItem(batch.items, index, targetIndex)) {
              renderDocsDraftModal(batch, filesById, docOptions);
            }
          });
          reorder.appendChild(moveBtn);
        };

        addMoveButton('Primeiro', 0);
        addMoveButton('Subir', index - 1);
        addMoveButton('Descer', index + 1);
        addMoveButton('Ultimo', batch.items.length - 1);
        name.appendChild(reorder);
        row.appendChild(name);

        const typeWrap = document.createElement('div');
        typeWrap.className = `${EXT}-field`;
        typeWrap.innerHTML = '<label>Tipo de documento</label>';
        const typeSelect = buildReferenceSelect(docOptions, item.documentValue);
        typeSelect.addEventListener('change', () => {
          item.documentValue = typeSelect.value;
          item.documentText = typeSelect.selectedOptions[0]?.textContent?.trim() || '';
          if (!needsDocComplement(item.documentText)) item.complement = '';
          renderDocsDraftModal(batch, filesById, docOptions);
        });
        typeWrap.appendChild(typeSelect);
        row.appendChild(typeWrap);

        const complementWrap = document.createElement('div');
        complementWrap.className = `${EXT}-field`;
        complementWrap.innerHTML = '<label>Descricao do tipo</label>';
        const complement = document.createElement('input');
        complement.type = 'text';
        complement.value = item.complement || '';
        complement.placeholder = 'Obrigatorio para Outros';
        complement.disabled = !needsDocComplement(item.documentText);
        complement.addEventListener('input', () => {
          item.complement = complement.value.trim();
        });
        complementWrap.appendChild(complement);
        row.appendChild(complementWrap);

        const status = document.createElement('span');
        status.className = `${EXT}-status`;
        status.textContent = 'Pendente';
        row.appendChild(status);

        items.appendChild(row);
      });

      body.appendChild(items);

      const progress = getProgress(batch);
      const progressWrap = document.createElement('div');
      progressWrap.className = `${EXT}-progressWrap`;
      progressWrap.innerHTML = `
        <div class="${EXT}-progressText">Pronto para relacionar ${progress.total} documento(s).</div>
        <div class="${EXT}-progress"><span style="--pct: 0%"></span></div>
      `;

      const actions = document.createElement('div');
      actions.className = `${EXT}-actions`;

      const cancel = createButton('Cancelar');
      cancel.addEventListener('click', closeModal);

      const start = createButton('Enviar documentos', 'primary');
      start.addEventListener('click', async () => {
        const missingType = batch.items.filter(item => !item.documentValue);
        if (missingType.length) {
          toast(`Escolha o tipo de ${missingType.length} documento(s).`);
          return;
        }

        const missingComplement = batch.items.filter(item => needsDocComplement(item.documentText) && !item.complement);
        if (missingComplement.length) {
          toast(`Preencha a descricao do tipo em ${missingComplement.length} documento(s) marcados como Outros.`);
          return;
        }

        start.disabled = true;
        cancel.disabled = true;

        batch.running = true;
        batch.startedAt = Date.now();
        batch.items.forEach(item => {
          item.status = 'pending';
          item.error = null;
        });

        try {
          await clearDocsBatch();
          await storeFiles(filesById);
          await saveDocsBatch(stripPreviewUrls(batch));
          renderSavedDocsModal(stripPreviewUrls(batch));
          scheduleDocsResume(300);
        } catch (err) {
          console.error('[SIMIL-DOCS-LOTE] erro ao salvar lote:', err);
          start.disabled = false;
          cancel.disabled = false;
          toast(`Erro ao preparar os documentos: ${err.message || err}`);
        }
      });

      actions.appendChild(cancel);
      actions.appendChild(start);
      footer.appendChild(progressWrap);
      footer.appendChild(actions);
    };

    const renderSavedDocsModal = (batch) => {
      const progress = getProgress(batch);
      const subtitle = batch.running
        ? `Relacionando ${progress.done}/${progress.total}`
        : `Fila pausada: ${progress.done}/${progress.total}`;
      const { body, footer } = createBatchDialog(batch, subtitle, 'Relacionar documentos em lote');

      const notice = document.createElement('p');
      notice.className = `${EXT}-notice`;
      notice.textContent = batch.running
        ? 'Mantenha a aba Doc./Finalizacao aberta. Se o SIMIL recarregar a pagina, a extensao continua do proximo item.'
        : 'A fila esta pausada. Voce pode retomar ou limpar os arquivos temporarios.';
      body.appendChild(notice);

      const items = document.createElement('div');
      items.className = `${EXT}-items`;

      batch.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `${EXT}-item`;

        const icon = document.createElement('div');
        icon.className = `${EXT}-thumb`;
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.color = '#60717d';
        icon.style.font = '700 12px Arial, sans-serif';
        icon.textContent = 'DOC';
        row.appendChild(icon);

        const name = document.createElement('div');
        name.className = `${EXT}-name`;
        name.textContent = `${index + 1}. ${item.name}`;
        const meta = document.createElement('span');
        meta.className = `${EXT}-meta`;
        meta.textContent = item.documentText || 'Sem tipo';
        name.appendChild(meta);
        if (item.complement) {
          const complement = document.createElement('span');
          complement.className = `${EXT}-meta`;
          complement.textContent = item.complement;
          name.appendChild(complement);
        }
        if (item.error) {
          const err = document.createElement('div');
          err.className = `${EXT}-errorText`;
          err.textContent = item.error;
          name.appendChild(err);
        }
        row.appendChild(name);

        const typeWrap = document.createElement('div');
        typeWrap.className = `${EXT}-field`;
        typeWrap.innerHTML = '<label>Tipo de documento</label>';
        const type = document.createElement('input');
        type.type = 'text';
        type.value = item.documentText || '';
        type.disabled = true;
        typeWrap.appendChild(type);
        row.appendChild(typeWrap);

        const complementWrap = document.createElement('div');
        complementWrap.className = `${EXT}-field`;
        complementWrap.innerHTML = '<label>Descricao do tipo</label>';
        const complement = document.createElement('input');
        complement.type = 'text';
        complement.value = item.complement || '';
        complement.disabled = true;
        complementWrap.appendChild(complement);
        row.appendChild(complementWrap);

        const status = document.createElement('span');
        status.className = `${EXT}-status ${item.status || 'pending'}`;
        status.textContent = docStatusLabel(item.status);
        row.appendChild(status);

        items.appendChild(row);
      });

      body.appendChild(items);

      const progressWrap = document.createElement('div');
      progressWrap.className = `${EXT}-progressWrap`;
      progressWrap.innerHTML = `
        <div class="${EXT}-progressText">${progress.done}/${progress.total} documento(s) relacionado(s).</div>
        <div class="${EXT}-progress"><span style="--pct: ${progress.pct}%"></span></div>
      `;

      const actions = document.createElement('div');
      actions.className = `${EXT}-actions`;

      if (!batch.running && batch.items.some(item => item.status !== 'done')) {
        const resume = createButton('Retomar', 'primary');
        resume.addEventListener('click', async () => {
          batch.running = true;
          batch.items.forEach(item => {
            if (item.status === 'error') {
              item.status = 'pending';
              item.error = null;
            }
          });
          await saveDocsBatch(batch);
          renderSavedDocsModal(batch);
          scheduleDocsResume(300);
        });
        actions.appendChild(resume);
      }

      if (batch.running) {
        const continueBtn = createButton('Continuar agora', 'primary');
        continueBtn.addEventListener('click', () => scheduleDocsResume(100));
        actions.appendChild(continueBtn);
      }

      const clear = createButton('Limpar fila', 'danger');
      clear.addEventListener('click', async () => {
        if (!confirm('Limpar a fila temporaria de documentos desta extensao?')) return;
        await clearDocsBatch();
        closeModal();
        toast('Fila temporaria de documentos limpa.');
      });
      actions.appendChild(clear);

      footer.appendChild(progressWrap);
      footer.appendChild(actions);
    };

    const selectReferenceOnPage = (select, item) => {
      const options = [...select.options];
      let option = options.find(opt => opt.value === item.referenceValue);
      if (!option && item.referenceText) {
        const wanted = normalize(item.referenceText);
        option = options.find(opt => normalize(opt.textContent) === wanted);
      }
      if (!option) return false;

      select.focus();
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.blur();
      return true;
    };

    const fillDescriptionOnPage = (input, value) => {
      input.focus();
      setNativeInputValue(input, value || '');
      dispatchValueEvents(input);
      input.blur();
      return true;
    };

    const attachFileOnPage = (input, file) => {
      if (typeof DataTransfer === 'undefined') {
        throw new Error('DataTransfer nao esta disponivel neste navegador.');
      }

      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));

      return input.files?.length === 1;
    };

    const selectDocTypeOnPage = (select, item) => {
      const options = [...select.options];
      let option = options.find(opt => opt.value === item.documentValue);
      if (!option && item.documentText) {
        const wanted = normalize(item.documentText);
        option = options.find(opt => normalize(opt.textContent) === wanted);
      }
      if (!option) return false;

      select.focus();
      select.value = option.value;
      option.selected = true;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.blur();
      return true;
    };

    const findComplementDialog = () => {
      const dialogs = [...document.querySelectorAll('.ui-dialog, .modal, [role="dialog"]')]
        .filter(el => !el.closest(`#${MODAL_ID}`) && isVisible(el));

      return dialogs.find(dialog => {
        const txt = normalize(dialog.textContent || '');
        const hasTextField = [...dialog.querySelectorAll('textarea, input[type="text"], input:not([type])')]
          .some(el => !el.disabled && !el.readOnly && isVisible(el));
        return hasTextField && (
          txt.includes('complem') ||
          txt.includes('outros') ||
          txt.includes('descricao') ||
          txt.includes('documento')
        );
      }) || null;
    };

    const findDialogConfirmButton = (dialog) => {
      const buttons = [...dialog.querySelectorAll('button, a, span, input[type="button"], input[type="submit"]')]
        .filter(el => !el.disabled && isVisible(el));

      return buttons.find(el => {
        const txt = normalize(el.textContent || el.value || el.getAttribute('title') || '');
        return ['ok', 'salvar', 'confirmar', 'adicionar', 'continuar'].includes(txt);
      }) || buttons.find(el => {
        const txt = normalize(el.textContent || el.value || el.getAttribute('title') || '');
        return !txt.includes('cancel') && !txt.includes('fechar');
      }) || null;
    };

    const fillDocComplementDialogIfPresent = async (item, timeout = 1500) => {
      if (!needsDocComplement(item.documentText)) return false;

      const dialog = await waitFor(findComplementDialog, timeout, 120);
      if (!dialog) return false;

      const input = [...dialog.querySelectorAll('textarea, input[type="text"], input:not([type])')]
        .find(el => !el.disabled && !el.readOnly && isVisible(el));

      if (!input) {
        throw new Error('A janela de informacao complementar abriu, mas nao encontrei o campo de descricao.');
      }

      input.focus();
      setNativeInputValue(input, item.complement || '');
      dispatchValueEvents(input);
      input.blur();

      const confirmButton = findDialogConfirmButton(dialog);
      if (confirmButton) {
        clickLikeUser(confirmButton);
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      }

      await sleep(350);
      return true;
    };

    const detectUploadResult = (item) => {
      const pageText = normalize(document.body?.textContent || '');
      if (pageText.includes('arquivo anexado com sucesso')) {
        return { success: true };
      }

      const panel = findPhotoPanel();
      const panelText = normalize(panel?.textContent || '');
      const desc = normalize(item.description);
      const ref = normalize(item.referenceText);

      if (desc && ref && panelText.includes(desc) && panelText.includes(ref)) {
        return { success: true };
      }

      const errorNode = [...document.querySelectorAll('.ui-messages-error, .ui-message-error, .alert-error, .alert-danger')]
        .find(isVisible);
      if (errorNode) {
        return { error: errorNode.textContent.trim() || 'O SIMIL retornou uma mensagem de erro.' };
      }

      return null;
    };

    const detectDocUploadResult = (item) => {
      const pageText = normalize(document.body?.textContent || '');
      if (
        pageText.includes('registro gravado com sucesso') ||
        pageText.includes('arquivo anexado com sucesso')
      ) {
        return { success: true };
      }

      const panel = findDocsPanel();
      const panelText = normalize(panel?.textContent || '');
      const docType = normalize(item.documentText);
      const complement = normalize(item.complement);

      if (docType && panelText.includes(docType) && panelText.includes('anexado')) {
        return { success: true };
      }

      if (complement && panelText.includes(complement) && panelText.includes('anexado')) {
        return { success: true };
      }

      const errorNode = [...document.querySelectorAll('.ui-messages-error, .ui-message-error, .alert-error, .alert-danger')]
        .find(isVisible);
      if (errorNode) {
        return { error: errorNode.textContent.trim() || 'O SIMIL retornou uma mensagem de erro.' };
      }

      return null;
    };

    const clearStaleSuccessMessages = () => {
      [...document.querySelectorAll('div, li, span')]
        .filter(el => {
          const txt = normalize(el.textContent || '');
          return (
            (txt.includes('arquivo anexado com sucesso') || txt.includes('registro gravado com sucesso')) &&
            txt.length < 180
          );
        })
        .forEach(el => el.remove());
    };

    const reconcileSubmitting = async (batch) => {
      const submitting = batch.items.find(item => item.status === 'submitting');
      if (!submitting) return batch;

      const result = detectUploadResult(submitting);
      if (result?.success) {
        submitting.status = 'done';
        submitting.error = null;
        submitting.doneAt = Date.now();
        await saveBatch(batch);
        return batch;
      }

      if (result?.error) {
        submitting.status = 'error';
        submitting.error = result.error;
        batch.running = false;
        await saveBatch(batch);
        return batch;
      }

      submitting.status = 'error';
      submitting.error = 'Nao consegui confirmar se esta foto foi anexada depois do recarregamento.';
      batch.running = false;
      await saveBatch(batch);
      return batch;
    };

    const completeBatch = async (batch) => {
      const total = batch.items.length;
      await clearBatch();
      closeModal();
      toast(`Lote concluido. ${total} foto(s) anexada(s).`, 5200);
    };

    const pauseBatchWithError = async (batch, item, message) => {
      item.status = 'error';
      item.error = message;
      batch.running = false;
      await saveBatch(batch);
      renderSavedBatchModal(batch);
      toast(message, 5200);
    };

    const submitOneItem = async (batch, item) => {
      const panel = await waitFor(() => {
        const root = findPhotoPanel();
        return root && isVisible(root) ? root : null;
      }, 6000);

      if (!panel) {
        throw new Error('Abra a aba Fotos do SIMIL para continuar.');
      }

      const refs = await waitFor(() => {
        const found = {
          select: findReferenceSelect(panel),
          description: findDescriptionInput(panel),
          file: findFileInput(panel),
          add: findAddButton(panel)
        };
        return found.select && found.description && found.file && found.add ? found : null;
      }, 3000);

      const select = refs?.select;
      const description = refs?.description;
      const fileInput = refs?.file;
      let addButton = refs?.add;

      if (!select) throw new Error('Nao encontrei o campo Referencia Foto.');
      if (!description) throw new Error('Nao encontrei o campo Descricao Foto.');
      if (!fileInput) throw new Error('Nao encontrei o campo de arquivo Foto.');
      if (!addButton) throw new Error('Nao encontrei o botao Adicionar.');

      if (!selectReferenceOnPage(select, item)) {
        throw new Error(`Referencia nao encontrada no SIMIL: ${item.referenceText || item.referenceValue}`);
      }

      clearStaleSuccessMessages();
      fillDescriptionOnPage(description, item.description || '');

      const file = await getFileForItem(item);
      if (!attachFileOnPage(fileInput, file)) {
        throw new Error(`Nao consegui colocar o arquivo no campo Foto: ${item.name}`);
      }

      addButton = await waitFor(() => {
        const fresh = findAddButton(findPhotoPanel());
        return fresh && !isDisabledButton(fresh) ? fresh : null;
      }, 5000);

      if (!addButton) {
        throw new Error('O botao Adicionar nao ficou habilitado apos selecionar a foto.');
      }

      item.status = 'submitting';
      item.error = null;
      item.submittedAt = Date.now();
      await saveBatch(batch);
      renderSavedBatchModal(batch);

      clickLikeUser(addButton);

      const result = await waitFor(() => detectUploadResult(item), 25000, 250);
      if (result?.success) {
        item.status = 'done';
        item.error = null;
        item.doneAt = Date.now();
        await saveBatch(batch);
        return true;
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      throw new Error('O envio nao foi confirmado dentro do tempo esperado.');
    };

    const reconcileDocsSubmitting = async (batch) => {
      const submitting = batch.items.find(item => item.status === 'submitting');
      if (!submitting) return batch;

      const result = detectDocUploadResult(submitting);
      if (result?.success) {
        submitting.status = 'done';
        submitting.error = null;
        submitting.doneAt = Date.now();
        await saveDocsBatch(batch);
        return batch;
      }

      if (result?.error) {
        submitting.status = 'error';
        submitting.error = result.error;
        batch.running = false;
        await saveDocsBatch(batch);
        return batch;
      }

      submitting.status = 'error';
      submitting.error = 'Nao consegui confirmar se este documento foi relacionado depois do recarregamento.';
      batch.running = false;
      await saveDocsBatch(batch);
      return batch;
    };

    const completeDocsBatch = async (batch) => {
      const total = batch.items.length;
      await clearDocsBatch();
      closeModal();
      toast(`Lote concluido. ${total} documento(s) relacionado(s).`, 5200);
    };

    const pauseDocsBatchWithError = async (batch, item, message) => {
      item.status = 'error';
      item.error = message;
      batch.running = false;
      await saveDocsBatch(batch);
      renderSavedDocsModal(batch);
      toast(message, 5200);
    };

    const submitOneDocItem = async (batch, item) => {
      const panel = await waitFor(() => {
        const root = findDocsPanel();
        return root && isVisible(root) ? root : null;
      }, 6000);

      if (!panel) {
        throw new Error('Abra a aba Doc./Finalizacao do SIMIL para continuar.');
      }

      const refs = await waitFor(() => {
        const found = {
          select: findDocTypeSelect(panel),
          file: findDocFileInput(panel),
          relate: findRelateButton(panel)
        };
        return found.select && found.file && found.relate ? found : null;
      }, 3000);

      const select = refs?.select;
      const fileInput = refs?.file;
      let relateButton = refs?.relate;

      if (!select) throw new Error('Nao encontrei o campo Relacao Geral.');
      if (!fileInput) throw new Error('Nao encontrei o campo Anexo.');
      if (!relateButton) throw new Error('Nao encontrei o botao Relacionar.');

      clearStaleSuccessMessages();

      if (!selectDocTypeOnPage(select, item)) {
        throw new Error(`Tipo de documento nao encontrado no SIMIL: ${item.documentText || item.documentValue}`);
      }

      await fillDocComplementDialogIfPresent(item, 1800);

      const file = await getFileForItem(item);
      if (!attachFileOnPage(fileInput, file)) {
        throw new Error(`Nao consegui colocar o arquivo no campo Anexo: ${item.name}`);
      }

      relateButton = await waitFor(() => {
        const fresh = findRelateButton(findDocsPanel());
        return fresh && !isDisabledButton(fresh) ? fresh : null;
      }, 5000);

      if (!relateButton) {
        throw new Error('O botao Relacionar nao ficou habilitado apos selecionar o documento.');
      }

      item.status = 'submitting';
      item.error = null;
      item.submittedAt = Date.now();
      await saveDocsBatch(batch);
      renderSavedDocsModal(batch);

      clickLikeUser(relateButton);
      await fillDocComplementDialogIfPresent(item, 3500);

      const result = await waitFor(() => detectDocUploadResult(item), 25000, 250);
      if (result?.success) {
        item.status = 'done';
        item.error = null;
        item.doneAt = Date.now();
        await saveDocsBatch(batch);
        return true;
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      throw new Error('O relacionamento do documento nao foi confirmado dentro do tempo esperado.');
    };

    const processActiveBatch = async () => {
      if (processing) return;
      processing = true;

      try {
        let batch = await loadBatch();
        if (!batch) return;

        batch = await reconcileSubmitting(batch);
        renderSavedBatchModal(batch);

        if (!batch.running) return;

        const next = batch.items.find(item => item.status === 'pending' || !item.status);
        if (!next) {
          await completeBatch(batch);
          return;
        }

        try {
          await submitOneItem(batch, next);
        } catch (err) {
          await pauseBatchWithError(batch, next, err.message || String(err));
          return;
        }

        const fresh = await loadBatch();
        if (fresh?.running) {
          renderSavedBatchModal(fresh);
          scheduleResume(600);
        }
      } finally {
        processing = false;
      }
    };

    const scheduleResume = (delay = 900) => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        processActiveBatch().catch(err => {
          console.error('[SIMIL-FOTOS-LOTE] erro ao processar lote:', err);
          toast(`Erro ao processar lote: ${err.message || err}`);
        });
      }, delay);
    };

    const processActiveDocsBatch = async () => {
      if (docsProcessing) return;
      docsProcessing = true;

      try {
        let batch = await loadDocsBatch();
        if (!batch) return;

        batch = await reconcileDocsSubmitting(batch);
        renderSavedDocsModal(batch);

        if (!batch.running) return;

        const next = batch.items.find(item => item.status === 'pending' || !item.status);
        if (!next) {
          await completeDocsBatch(batch);
          return;
        }

        try {
          await submitOneDocItem(batch, next);
        } catch (err) {
          await pauseDocsBatchWithError(batch, next, err.message || String(err));
          return;
        }

        const fresh = await loadDocsBatch();
        if (fresh?.running) {
          renderSavedDocsModal(fresh);
          scheduleDocsResume(600);
        }
      } finally {
        docsProcessing = false;
      }
    };

    const scheduleDocsResume = (delay = 900) => {
      clearTimeout(docsResumeTimer);
      docsResumeTimer = setTimeout(() => {
        processActiveDocsBatch().catch(err => {
          console.error('[SIMIL-DOCS-LOTE] erro ao processar lote:', err);
          toast(`Erro ao processar lote de documentos: ${err.message || err}`);
        });
      }, delay);
    };

    const createDraftBatch = (files, referenceOptions) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return {
        id,
        createdAt: Date.now(),
        running: false,
        items: files.map((file, index) => ({
          id: `${id}-${index}`,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          referenceValue: referenceOptions.length === 1 ? referenceOptions[0].value : '',
          referenceText: referenceOptions.length === 1 ? referenceOptions[0].text : '',
          description: '',
          status: 'pending',
          error: null
        }))
      };
    };

    const createDocsDraftBatch = (files, docOptions) => {
      const id = `docs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return {
        id,
        kind: 'docs',
        createdAt: Date.now(),
        running: false,
        items: files.map((file, index) => ({
          id: `${id}-${index}`,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          documentValue: docOptions.length === 1 ? docOptions[0].value : '',
          documentText: docOptions.length === 1 ? docOptions[0].text : '',
          complement: '',
          status: 'pending',
          error: null
        }))
      };
    };

    const handleSelectedFiles = async (fileList) => {
      const files = [...fileList].filter(file => /^image\//i.test(file.type) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name));
      if (!files.length) {
        toast('Selecione arquivos de imagem.');
        return;
      }

      const existing = countExistingPhotos();
      const available = Math.max(0, MAX_FOTOS - existing);
      if (available <= 0) {
        toast(`O laudo ja parece ter ${existing} foto(s). O limite e ${MAX_FOTOS}.`);
        return;
      }

      if (files.length > available) {
        toast(`Selecione no maximo ${available} foto(s). O laudo parece ter ${existing} foto(s) ja anexada(s).`, 5200);
        return;
      }

      const referenceOptions = readReferenceOptions();
      if (!referenceOptions.length) {
        toast('Nao consegui ler as opcoes de Referencia Foto. Abra a aba Fotos e tente novamente.');
        return;
      }

      const filesById = new Map();
      const batch = createDraftBatch(files, referenceOptions);
      batch.items.forEach((item, index) => filesById.set(item.id, files[index]));
      renderDraftModal(batch, filesById, referenceOptions);
    };

    const handleSelectedDocs = async (fileList) => {
      const files = [...fileList].filter(file => file.size > 0);
      if (!files.length) {
        toast('Selecione os arquivos de documento.');
        return;
      }

      const docOptions = readDocTypeOptions();
      if (!docOptions.length) {
        toast('Nao consegui ler as opcoes da Relacao Geral. Abra a aba Doc./Finalizacao e tente novamente.');
        return;
      }

      const filesById = new Map();
      const batch = createDocsDraftBatch(files, docOptions);
      batch.items.forEach((item, index) => filesById.set(item.id, files[index]));
      renderDocsDraftModal(batch, filesById, docOptions);
    };

    const ensurePicker = () => {
      let input = document.getElementById(PICKER_ID);
      if (input) return input;

      input = document.createElement('input');
      input.id = PICKER_ID;
      input.type = 'file';
      input.accept = 'image/*,.jpg,.jpeg,.png,.gif,.webp,.bmp';
      input.multiple = true;
      input.style.display = 'none';

      input.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        input.value = '';
        if (!files.length) return;

        const active = await loadBatch();
        const activeDocs = await loadDocsBatch();
        if (
          active?.items?.some(item => item.status !== 'done') ||
          activeDocs?.items?.some(item => item.status !== 'done')
        ) {
          const ok = confirm('Ja existe uma fila temporaria nesta extensao. Limpar essa fila e comecar outra?');
          if (!ok) return;
          await clearBatch();
        }

        handleSelectedFiles(files).catch(err => {
          console.error('[SIMIL-FOTOS-LOTE] erro ao selecionar fotos:', err);
          toast(`Erro ao selecionar fotos: ${err.message || err}`);
        });
      });

      (document.body || document.documentElement).appendChild(input);
      return input;
    };

    const ensureDocsPicker = () => {
      let input = document.getElementById(DOC_PICKER_ID);
      if (input) return input;

      input = document.createElement('input');
      input.id = DOC_PICKER_ID;
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt,.zip,application/pdf,image/*';
      input.multiple = true;
      input.style.display = 'none';

      input.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        input.value = '';
        if (!files.length) return;

        const active = await loadBatch();
        const activeDocs = await loadDocsBatch();
        if (
          active?.items?.some(item => item.status !== 'done') ||
          activeDocs?.items?.some(item => item.status !== 'done')
        ) {
          const ok = confirm('Ja existe uma fila temporaria nesta extensao. Limpar essa fila e comecar outra?');
          if (!ok) return;
          await clearDocsBatch();
        }

        handleSelectedDocs(files).catch(err => {
          console.error('[SIMIL-DOCS-LOTE] erro ao selecionar documentos:', err);
          toast(`Erro ao selecionar documentos: ${err.message || err}`);
        });
      });

      (document.body || document.documentElement).appendChild(input);
      return input;
    };

    const openPicker = async () => {
      const panel = findPhotoPanel();
      if (!panel || !isVisible(panel)) {
        toast('Abra a aba Fotos do SIMIL antes de selecionar as imagens.');
        return;
      }
      ensurePicker().click();
    };

    const openDocsPicker = async () => {
      const panel = findDocsPanel();
      if (!panel || !isVisible(panel)) {
        toast('Abra a aba Doc./Finalizacao do SIMIL antes de selecionar os documentos.');
        return;
      }
      ensureDocsPicker().click();
    };

    const styleInlineBatchButton = (btn) => {
      btn.style.cssText = `
        margin-left: auto;
        padding: 10px 12px;
        border: 0;
        border-radius: 3px;
        background: #198754;
        color: #fff;
        font: 700 13px Arial, sans-serif;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0,0,0,.14);
        vertical-align: middle;
        margin-top: 8px;
      `;
    };

    const styleFloatingBatchButton = (btn) => {
      btn.style.cssText = `
        position: fixed;
        right: 16px;
        bottom: 160px;
        z-index: 2147483645;
        padding: 10px 12px;
        border: 0;
        border-radius: 10px;
        background: #198754;
        color: #fff;
        font: 700 13px Arial, sans-serif;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
      `;
    };

    const ensureBatchButton = () => {
      const panel = findPhotoPanel();
      const existing = document.getElementById(BTN_ID);

      if (!panel || !isVisible(panel)) {
        existing?.remove();
        return;
      }

      if (existing) return;

      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = 'Anexar em Lote';
      btn.title = 'Selecionar varias fotos e anexar uma por uma';
      btn.addEventListener('click', openPicker);

      const add = findAddButton(panel);
      if (add?.parentElement) {
        styleInlineBatchButton(btn);
        add.insertAdjacentElement('afterend', btn);
      } else {
        styleFloatingBatchButton(btn);
        (document.body || document.documentElement).appendChild(btn);
      }
    };

    const ensureDocsButton = () => {
      const panel = findDocsPanel();
      const existing = document.getElementById(DOC_BTN_ID);

      if (!panel || !isVisible(panel)) {
        existing?.remove();
        return;
      }

      if (existing) return;

      const btn = document.createElement('button');
      btn.id = DOC_BTN_ID;
      btn.type = 'button';
      btn.textContent = 'Relacionar em Lote';
      btn.title = 'Selecionar varios documentos e relacionar um por um';
      btn.addEventListener('click', openDocsPicker);

      const relate = findRelateButton(panel);
      if (relate?.parentElement) {
        styleInlineBatchButton(btn);
        relate.insertAdjacentElement('afterend', btn);
      } else {
        styleFloatingBatchButton(btn);
        (document.body || document.documentElement).appendChild(btn);
      }
    };

    const initActiveBatch = async () => {
      const batch = await loadBatch();
      if (!batch) return;

      const isOld = batch.createdAt && Date.now() - batch.createdAt > 24 * 60 * 60 * 1000;
      if (isOld && !batch.running) {
        await clearBatch();
        return;
      }

      renderSavedBatchModal(batch);
      if (batch.running) scheduleResume(1200);
    };

    const initActiveDocsBatch = async () => {
      const batch = await loadDocsBatch();
      if (!batch) return;

      const isOld = batch.createdAt && Date.now() - batch.createdAt > 24 * 60 * 60 * 1000;
      if (isOld && !batch.running) {
        await clearDocsBatch();
        return;
      }

      renderSavedDocsModal(batch);
      if (batch.running) scheduleDocsResume(1200);
    };

    ensureBatchButton();
    ensureDocsButton();
    ensurePicker();
    ensureDocsPicker();
    initActiveBatch().catch(err => {
      console.error('[SIMIL-FOTOS-LOTE] erro ao inicializar lote:', err);
    });
    initActiveDocsBatch().catch(err => {
      console.error('[SIMIL-DOCS-LOTE] erro ao inicializar lote:', err);
    });

    const obs = new MutationObserver(() => {
      ensureBatchButton();
      ensureDocsButton();
    });

    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
  } catch (err) {
    console.error('[SIMIL-FOTOS-LOTE] erro:', err);
  }
})();
