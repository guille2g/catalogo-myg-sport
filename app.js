import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CONFIG = window.APP_CONFIG;
const app = initializeApp(CONFIG.firebaseConfig);
const db = getFirestore(app);
const productsCol = collection(db, "productos");

const params = new URLSearchParams(window.location.search);
const explicitList = params.get("lista");

const state = {
  mode: explicitList === "mayorista" ? "mayorista" : "minorista",
  products: [],
  cart: {},
  activeSlides: {},
  draftImages: [],
  lbProductId: null,
  lbIndex: 0
};

document.getElementById("brandTitle").textContent = CONFIG.storeName;

function formatMoney(num) {
  return "$" + Number(num || 0).toLocaleString("es-AR");
}

function updateHeaderVisibility() {
  const isHashAdmin = window.location.hash === "#admin";
  const actions = document.getElementById("headerActions");
  actions.style.display = (explicitList && !isHashAdmin) ? "none" : "flex";
}

function setMode(newMode) {
  state.mode = newMode;
  state.cart = {};
  render();
}

/* --- COMPRESIÓN DE FOTOS PARA FIRESTORE GRATUITO --- */
function compressImageFile(file, maxWidth = 720, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* --- SUSCRIPCIÓN EN TIEMPO REAL A FIRESTORE --- */
const q = query(productsCol, orderBy("createdAt", "desc"));
onSnapshot(q, (snapshot) => {
  document.getElementById("loadingMsg").style.display = "none";
  state.products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
  if (document.getElementById("adminPanel").style.display === "block") {
    renderAdminList();
  }
}, (error) => {
  console.error("Error leyendo Firestore:", error);
  document.getElementById("loadingMsg").textContent =
    "No se pudo conectar con Firestore. Revisá que la base de datos esté creada y en modo de prueba.";
});

/* --- ADMINISTRADOR --- */
function toggleAdmin() {
  const panel = document.getElementById("adminPanel");
  if (panel.style.display === "block") {
    closeAdmin();
    return;
  }
  const pass = prompt("Ingresá tu clave de administrador:");
  if (pass !== CONFIG.adminPass) {
    alert("Clave incorrecta");
    return;
  }
  panel.style.display = "block";
  renderAdminList();
}

function closeAdmin() {
  document.getElementById("adminPanel").style.display = "none";
  resetForm();
}

async function handleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  for (const file of files) {
    if (state.draftImages.length >= 4) {
      alert("Máximo 4 fotos por producto para mantener la carga rápida y gratuita.");
      break;
    }
    const compressed = await compressImageFile(file);
    state.draftImages.push(compressed);
    renderDraftPreviews();
  }
}

function renderDraftPreviews() {
  const strip = document.getElementById("imagePreviewStrip");
  strip.innerHTML = state.draftImages.map((src, idx) => `
    <div class="preview-thumb">
      <img src="${src}" alt="Preview ${idx + 1}" />
      <button type="button" data-remove-idx="${idx}" title="Quitar foto">✕</button>
    </div>
  `).join("");

  strip.querySelectorAll("[data-remove-idx]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-remove-idx"));
      state.draftImages.splice(idx, 1);
      renderDraftPreviews();
    };
  });
}

async function saveProduct() {
  const editId = document.getElementById("editProductId").value;
  const name = document.getElementById("pName").value.trim();
  const category = document.getElementById("pCategory").value.trim() || "General";
  const desc = document.getElementById("pDesc").value.trim();
  const priceMin = Number(document.getElementById("pPriceMin").value);
  const priceMay = Number(document.getElementById("pPriceMay").value);
  const inStock = document.getElementById("pStock").value === "true";

  if (!name || !priceMin) {
    alert("Completá al menos el nombre y el precio minorista.");
    return;
  }

  const images = state.draftImages.length > 0
    ? [...state.draftImages]
    : ["https://via.placeholder.com/600x600/ffffff/646870?text=Sin+Foto"];

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando...";

  try {
    if (editId) {
      await updateDoc(doc(db, "productos", editId), {
        name,
        category,
        desc,
        priceMin,
        priceMay: priceMay || priceMin,
        inStock,
        images
      });
      state.activeSlides[editId] = 0;
    } else {
      await addDoc(productsCol, {
        name,
        category,
        desc,
        priceMin,
        priceMay: priceMay || priceMin,
        inStock,
        images,
        createdAt: serverTimestamp()
      });
    }
    resetForm();
  } catch (err) {
    console.error("Error guardando en Firestore:", err);
    alert("Error al guardar en la nube. Si cargaste muchas fotos juntas, probá con 1 o 2 fotos más livianas.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = document.getElementById("editProductId").value ? "Actualizar Producto" : "Guardar Producto";
  }
}

function editProduct(id) {
  const prod = state.products.find(p => p.id === id);
  if (!prod) return;

  document.getElementById("editProductId").value = prod.id;
  document.getElementById("formTitle").textContent = "Editando: " + prod.name;
  document.getElementById("saveBtn").textContent = "Actualizar Producto";
  document.getElementById("cancelEditBtn").style.display = "inline-block";

  document.getElementById("pName").value = prod.name;
  document.getElementById("pCategory").value = prod.category;
  document.getElementById("pDesc").value = prod.desc || "";
  document.getElementById("pPriceMin").value = prod.priceMin;
  document.getElementById("pPriceMay").value = prod.priceMay;
  document.getElementById("pStock").value = String(prod.inStock);

  state.draftImages = [...(prod.images || [])];
  renderDraftPreviews();
  document.getElementById("adminPanel").scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
  document.getElementById("editProductId").value = "";
  document.getElementById("formTitle").textContent = "Agregar Nuevo Producto";
  document.getElementById("saveBtn").textContent = "Guardar Producto";
  document.getElementById("cancelEditBtn").style.display = "none";

  document.getElementById("pName").value = "";
  document.getElementById("pCategory").value = "";
  document.getElementById("pDesc").value = "";
  document.getElementById("pPriceMin").value = "";
  document.getElementById("pPriceMay").value = "";
  document.getElementById("pStock").value = "true";
  state.draftImages = [];
  renderDraftPreviews();
}

function renderAdminList() {
  const list = document.getElementById("adminList");
  if (state.products.length === 0) {
    list.innerHTML = `<p style="color:var(--muted);font-size:0.88rem;">Todavía no cargaste productos en la nube. Agregá el primero arriba.</p>`;
    return;
  }

  list.innerHTML = state.products.map(p => `
    <div class="admin-item">
      <div class="admin-item-info">
        <img src="${(p.images && p.images[0]) || ''}" alt="" />
        <div>
          <strong>${p.name}</strong> <span style="color:var(--muted);font-size:0.8rem;">(${p.category})</span><br/>
          <span style="font-size:0.83rem;">Min: <strong>${formatMoney(p.priceMin)}</strong> | May: <strong>${formatMoney(p.priceMay)}</strong> • ${(p.images || []).length} foto(s)</span>
        </div>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm" data-toggle-stock="${p.id}">
          ${p.inStock ? "Pausar Stock" : "Activar Stock"}
        </button>
        <button class="btn btn-light btn-sm" style="border:1px solid #ccc;" data-edit-id="${p.id}">Editar</button>
        <button class="btn btn-primary btn-sm" data-delete-id="${p.id}">Borrar</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-toggle-stock]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-toggle-stock");
      const prod = state.products.find(p => p.id === id);
      if (!prod) return;
      await updateDoc(doc(db, "productos", id), { inStock: !prod.inStock });
      if (prod.inStock) delete state.cart[id];
    };
  });

  list.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.onclick = () => editProduct(btn.getAttribute("data-edit-id"));
  });

  list.querySelectorAll("[data-delete-id]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-delete-id");
      if (!confirm("¿Seguro que querés eliminar este producto de la nube?")) return;
      await deleteDoc(doc(db, "productos", id));
      delete state.cart[id];
    };
  });
}

/* --- GALERÍA Y LIGHTBOX --- */
function openLightbox(productId) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod || !prod.images || prod.images.length === 0) return;
  state.lbProductId = productId;
  state.lbIndex = state.activeSlides[productId] || 0;
  updateLightboxUI();
  document.getElementById("lightbox").classList.add("open");
}

function stepLightbox(delta) {
  const prod = state.products.find(p => p.id === state.lbProductId);
  if (!prod) return;
  const total = prod.images.length;
  state.lbIndex = (state.lbIndex + delta + total) % total;
  updateLightboxUI();
}

function updateLightboxUI() {
  const prod = state.products.find(p => p.id === state.lbProductId);
  if (!prod) return;
  document.getElementById("lbImg").src = prod.images[state.lbIndex];
  document.getElementById("lbCaption").textContent = `${prod.name} (Foto ${state.lbIndex + 1} de ${prod.images.length})`;
  const showNav = prod.images.length > 1 ? "flex" : "none";
  document.getElementById("lbPrev").style.display = showNav;
  document.getElementById("lbNext").style.display = showNav;
}

/* --- CATÁLOGO Y CARRITO --- */
function getUnitPrice(product) {
  return state.mode === "mayorista" ? product.priceMay : product.priceMin;
}

function changeQty(productId, delta) {
  const current = state.cart[productId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete state.cart[productId];
  else state.cart[productId] = next;
  renderCart();
}

function updateCategoryDropdown() {
  const select = document.getElementById("categoryFilter");
  const currentVal = select.value;
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  select.innerHTML = `<option value="">Todas las categorías</option>` +
    categories.map(c => `<option value="${c}">${c}</option>`).join("");
  select.value = currentVal;
}

function renderCatalog() {
  const badge = document.getElementById("modeBadge");
  badge.textContent = state.mode === "mayorista" ? "Catálogo Mayorista" : "Catálogo Minorista";

  const banner = document.getElementById("wholesaleBanner");
  if (state.mode === "mayorista") {
    banner.style.display = "block";
    banner.innerHTML = `Compra mínima mayorista: <strong>${formatMoney(CONFIG.wholesaleMinimum)}</strong>. Pedidos con <strong>${CONFIG.pickupInfo}</strong>.`;
  } else {
    banner.style.display = "none";
  }

  const queryText = document.getElementById("searchInput").value.toLowerCase().trim();
  const catFilter = document.getElementById("categoryFilter").value;

  const filtered = state.products.filter(p => {
    const matchesText = p.name.toLowerCase().includes(queryText) || (p.desc || "").toLowerCase().includes(queryText);
    const matchesCat = !catFilter || p.category === catFilter;
    return matchesText && matchesCat;
  });

  const grid = document.getElementById("catalogGrid");
  if (filtered.length === 0 && state.products.length > 0) {
    grid.innerHTML = `<p class="status-msg" style="grid-column:1/-1;">No hay productos que coincidan con tu búsqueda.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const imgs = p.images && p.images.length ? p.images : ["https://via.placeholder.com/600x600?text=Producto"];
    const slideIdx = Math.min(state.activeSlides[p.id] || 0, imgs.length - 1);
    const price = getUnitPrice(p);
    const qty = state.cart[p.id] || 0;

    return `
      <article class="card">
        <div class="card-media" data-zoom-id="${p.id}">
          <img src="${imgs[slideIdx]}" alt="${p.name}" />
          <span class="zoom-hint">🔍 Ampliar</span>
          ${imgs.length > 1 ? `
            <button class="slide-btn prev" data-slide-prev="${p.id}">‹</button>
            <button class="slide-btn next" data-slide-next="${p.id}">›</button>
            <div class="dots">
              ${imgs.map((_, i) => `<span class="dot ${i === slideIdx ? 'active' : ''}"></span>`).join("")}
            </div>
          ` : ""}
        </div>
        <div class="card-body">
          <span class="category">${p.category}</span>
          <h3 class="title">${p.name}</h3>
          ${p.desc ? `<p class="desc">${p.desc}</p>` : ""}
          <div class="price">${formatMoney(price)}</div>
          ${!p.inStock
            ? `<div class="out-stock">Sin stock por el momento</div>`
            : `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <button class="btn btn-outline" data-qty-minus="${p.id}">-</button>
                <strong id="qty-${p.id}">${qty}</strong>
                <button class="btn btn-primary" data-qty-plus="${p.id}">+ Agregar</button>
               </div>`
          }
        </div>
      </article>
    `;
  }).join("");

  // Eventos de tarjetas
  grid.querySelectorAll("[data-zoom-id]").forEach(el => {
    el.onclick = () => openLightbox(el.getAttribute("data-zoom-id"));
  });
  grid.querySelectorAll("[data-slide-prev]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-slide-prev");
      const prod = state.products.find(p => p.id === id);
      const total = prod.images.length;
      state.activeSlides[id] = ((state.activeSlides[id] || 0) - 1 + total) % total;
      renderCatalog();
    };
  });
  grid.querySelectorAll("[data-slide-next]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-slide-next");
      const prod = state.products.find(p => p.id === id);
      const total = prod.images.length;
      state.activeSlides[id] = ((state.activeSlides[id] || 0) + 1) % total;
      renderCatalog();
    };
  });
  grid.querySelectorAll("[data-qty-minus]").forEach(btn => {
    btn.onclick = () => changeQty(btn.getAttribute("data-qty-minus"), -1);
  });
  grid.querySelectorAll("[data-qty-plus]").forEach(btn => {
    btn.onclick = () => changeQty(btn.getAttribute("data-qty-plus"), 1);
  });
}

function renderCart() {
  let totalItems = 0;
  let totalAmount = 0;

  for (const [id, qty] of Object.entries(state.cart)) {
    const prod = state.products.find(p => p.id === id);
    if (prod && qty > 0) {
      totalItems += qty;
      totalAmount += getUnitPrice(prod) * qty;
    }
    const qtyEl = document.getElementById(`qty-${id}`);
    if (qtyEl) qtyEl.textContent = qty;
  }

  document.querySelectorAll('[id^="qty-"]').forEach(el => {
    const id = el.id.replace("qty-", "");
    if (!state.cart[id]) el.textContent = 0;
  });

  const summary = document.getElementById("cartSummary");
  const sendBtn = document.getElementById("sendBtn");

  if (totalItems === 0) {
    summary.innerHTML = "Carrito vacío — elegí productos para armar tu pedido.";
    sendBtn.disabled = true;
    return;
  }

  if (state.mode === "mayorista" && totalAmount < CONFIG.wholesaleMinimum) {
    const diff = CONFIG.wholesaleMinimum - totalAmount;
    summary.innerHTML = `<strong>${totalItems}</strong> unid. | Subtotal: <strong>${formatMoney(totalAmount)}</strong> — Faltan <strong>${formatMoney(diff)}</strong> para el mínimo mayorista.`;
    sendBtn.disabled = true;
  } else {
    summary.innerHTML = `<strong>${totalItems}</strong> unid. | Total: <strong>${formatMoney(totalAmount)}</strong>`;
    sendBtn.disabled = false;
  }
}

function sendToWhatsApp() {
  let lines = [
    `Hola ${CONFIG.storeName}! Quiero hacer un pedido (${state.mode.toUpperCase()}):`,
    ""
  ];
  let totalAmount = 0;

  for (const [id, qty] of Object.entries(state.cart)) {
    const prod = state.products.find(p => p.id === id);
    if (prod && qty > 0) {
      const unit = getUnitPrice(prod);
      const sub = unit * qty;
      totalAmount += sub;
      lines.push(`• ${qty}x ${prod.name} (${formatMoney(unit)} c/u) = ${formatMoney(sub)}`);
    }
  }

  const payment = document.getElementById("paymentMethod").value;
  lines.push("");
  lines.push(`*Total: ${formatMoney(totalAmount)}*`);
  lines.push(`Pago: ${payment}`);
  lines.push(`Entrega: ${CONFIG.pickupInfo}`);

  const text = encodeURIComponent(lines.join("\n"));
  window.open(`https://wa.me/${CONFIG.whatsappNumber}?text=${text}`, "_blank");
}

function render() {
  updateHeaderVisibility();
  updateCategoryDropdown();
  renderCatalog();
  renderCart();
}

// Eventos globales
document.getElementById("btnModeMin").onclick = () => setMode("minorista");
document.getElementById("btnModeMay").onclick = () => setMode("mayorista");
document.getElementById("btnToggleAdmin").onclick = toggleAdmin;
document.getElementById("btnCloseAdmin").onclick = closeAdmin;
document.getElementById("pFiles").onchange = handleFilesSelected;
document.getElementById("saveBtn").onclick = saveProduct;
document.getElementById("cancelEditBtn").onclick = resetForm;
document.getElementById("searchInput").oninput = renderCatalog;
document.getElementById("categoryFilter").onchange = renderCatalog;
document.getElementById("sendBtn").onclick = sendToWhatsApp;

document.getElementById("lbClose").onclick = () => document.getElementById("lightbox").classList.remove("open");
document.getElementById("lightbox").onclick = (e) => {
  if (e.target.id === "lightbox") document.getElementById("lightbox").classList.remove("open");
};
document.getElementById("lbPrev").onclick = () => stepLightbox(-1);
document.getElementById("lbNext").onclick = () => stepLightbox(1);

window.addEventListener("hashchange", updateHeaderVisibility);
render();