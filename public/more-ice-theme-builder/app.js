const $ = (id) => document.getElementById(id);
const encoder = new TextEncoder();
const state = { active: "welcome", imageUrls: {}, layouts: {}, selected: null, drag: null, history: [], future: [], counter: 0 };
const MAX_PACKAGE_SIZE = 100 * 1024 * 1024;
const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
};

const screens = {
  welcome: {
    name: "Welcome", title: "Welcome", subtitle: "Create your perfect frozen treat", button: "START ORDER",
    labels: [["welcome_new_top", "Header", "WELCOME"], ["welcome_new_slogan", "Slogan", "Create your perfect frozen treat"], ["welcome_new_bottom", "Start button", "START ORDER"]],
    images: [["ui_new_welcome_page_bg", "Page background"], ["ui_new_welcome_logo", "Header logo"], ["ui_new_welcome_promotion", "Promotion image or MP4 video", "image/png,image/jpeg,image/webp,video/mp4"], ["ui_new_welcome_product", "Main product image"], ["ui_new_welcome_btn_bg", "Start button image"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_common_title", "Header"], ["color_new_welcome_slogan", "Slogan"], ["color_new_welcome_price", "Price"], ["color_new_welcome_info", "Information"], ["color_new_welcome_btn_start", "Start text"]]
  },
  catalog: {
    name: "Products", title: "Choose your favorite", subtitle: "Classic recipes", button: "CUSTOMIZE",
    labels: [["key_classic_new_slogan_key", "Slogan", "Choose your favorite"], ["key_classic_new_switch_diy_key", "Customize button", "CUSTOMIZE"]],
    images: [["ui_new_classic_page_bg", "Page background"], ["ui_new_classic_item_bg_1", "Product card 1"], ["ui_new_classic_item_bg_2", "Product card 2"], ["ui_new_classic_item_bg_3", "Product card 3"], ["ui_new_common_bar_bg", "Header bar"], ["ui_new_common_btn_back", "Back button"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_common_title", "Header"], ["color_new_classic_slogan", "Slogan"], ["color_new_classic_item_title", "Product title"], ["color_new_classic_item_desc", "Description"], ["color_new_classic_item_price", "Price"], ["color_new_classic_btn_diy", "Customize text"], ["color_new_classic_btn_back", "Back text"]]
  },
  diy: {
    name: "Customize", title: "Make it yours", subtitle: "Choose flavors and toppings", button: "NEXT",
    labels: [["key_diy_new_slogan_key", "Heading", "Make it yours"], ["key_diy_new_top_key", "Toppings heading", "Choose toppings"], ["key_diy_new_jam_key", "Sauces heading", "Choose sauces"], ["key_diy_new_switch_classic_key", "Classic button", "CLASSIC MENU"], ["key_diy_new_next_key", "Next button", "NEXT"]],
    images: [["ui_new_option_page_bg", "Page background"], ["ui_new_option_checked", "Selected state"], ["ui_new_option_number_add", "Add control"], ["ui_new_option_number_sub", "Subtract control"], ["ui_new_option_btn_next", "Next button"], ["ui_new_option_btn_classic", "Classic button"], ["ui_new_common_btn_back", "Back button"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_diy_title", "Heading"], ["color_new_diy_slogan", "Slogan"], ["color_new_diy_item_title", "Item title"], ["color_new_diy_item_price", "Item price"], ["color_new_diy_item_amount", "Quantity"], ["color_new_diy_price", "Total"], ["color_new_diy_btn_next", "Next text"], ["color_new_diy_btn_classic", "Classic text"], ["color_new_diy_btn_back", "Back text"]]
  },
  order: {
    name: "Order", title: "Review your order", subtitle: "Choose a cup and confirm", button: "PAY NOW",
    labels: [["order_new_top", "Header", "YOUR ORDER"], ["order_new_slogan", "Heading", "Review your order"], ["order_common_top_title", "Toppings label", "Toppings"], ["order_common_jam_title", "Sauces label", "Sauces"], ["order_new_total_cups", "Cup total label", "Total cups"], ["order_new_total_money", "Price total label", "Total price"], ["order_new_promo_code", "Promotion button", "PROMO CODE"], ["order_new_promo_code_del", "Remove promotion", "REMOVE PROMO"]],
    images: [["ui_new_order_page_bg", "Page background"], ["ui_new_order_cup_bg", "Cup image"], ["ui_new_order_cup_check", "Selected cup"], ["ui_new_common_btn_back", "Back button"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_order_title", "Heading"], ["color_new_order_details", "Summary"], ["color_new_order_item_title", "Item title"], ["color_new_order_item_detail", "Item details"], ["color_new_order_item_price", "Price"], ["color_new_order_btn_promo_add", "Add promotion"], ["color_new_order_btn_promo_sub", "Remove promotion"], ["color_new_order_btn_next", "Pay text"], ["color_new_order_btn_back", "Back text"]]
  },
  payment: {
    name: "Payment", title: "Complete payment", subtitle: "Follow the instructions", button: "CANCEL",
    images: [["ui_new_payment_btn_cancel", "Cancel button"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_payment_info", "Payment instructions"], ["color_new_payment_btn_text", "Cancel text"]]
  },
  warning: {
    name: "Messages", title: "One moment", subtitle: "Customer warnings and errors", button: "TRY AGAIN",
    labels: [["error_new_content", "Sold-out message", "Temporarily unavailable"]],
    images: [["ui_new_warn_page_bg", "Page background"], ["ui_new_warn_btn_set", "Action button"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_warn_msg", "Message text"]]
  },
  outing: {
    name: "Dispensing", title: "Preparing your order", subtitle: "Your treat is on the way", button: "COMPLETE",
    labels: [["process_new_top", "Header", "PREPARING"], ["process_new_slogan", "Status heading", "Preparing your order"], ["process_new_bottom", "Spoon reminder", "Please remember your spoon"], ["process_new_step1", "Step 1", "Starting"], ["process_new_step2", "Step 2", "Dispensing"], ["process_new_step3", "Step 3", "Finishing"]],
    images: [["ui_new_outing_page_bg", "Page background"], ["ui_new_outing_progress_bar", "Progress bar"], ["ui_new_outing_progress_dot_no", "Pending step"], ["ui_new_outing_progress_dot_yes", "Completed step"], ["ui_new_outing_spoon", "Spoon reminder"]],
    colors: [["color_new_common_primary", "Primary"], ["color_new_out_slogan", "Status message"], ["color_new_out_spoon_alert", "Spoon reminder"], ["color_new_out_step_no", "Pending step text"], ["color_new_out_step_ok", "Completed step text"]]
  }
};

const layerDefaults = {
  welcome: {
    header: { name: "Header / logo", x: 0, y: 0, w: 1080, h: 140, kind: "header", label: "welcome_new_top", media: "ui_new_welcome_logo" },
    promotion: { name: "Promotion media", x: 75, y: 210, w: 930, h: 550, kind: "promotion", media: "ui_new_welcome_promotion" },
    slogan: { name: "Slogan", x: 75, y: 790, w: 930, h: 110, kind: "text", label: "welcome_new_slogan" },
    product: { name: "Product image", x: 280, y: 920, w: 520, h: 611, kind: "image", media: "ui_new_welcome_product" },
    price: { name: "Price", x: 340, y: 1580, w: 400, h: 90, kind: "text", text: "FROM €3.00" },
    start: { name: "Start button", x: 315, y: 1730, w: 450, h: 90, kind: "button", label: "welcome_new_bottom" },
    footer: { name: "Footer information", x: 20, y: 1820, w: 1040, h: 80, kind: "text", text: "OWNER · CONTACT · VERSION" }
  },
  catalog: {
    header: { name: "Header", x: 0, y: 0, w: 1080, h: 140, kind: "header", text: "PRODUCTS" },
    slogan: { name: "Slogan", x: 80, y: 190, w: 920, h: 140, kind: "text", label: "key_classic_new_slogan_key" },
    products: { name: "Product grid", x: 80, y: 380, w: 920, h: 1120, kind: "cards", text: "PRODUCT" },
    back: { name: "Back button", x: 80, y: 1650, w: 300, h: 100, kind: "button", text: "BACK" },
    customize: { name: "Customize button", x: 580, y: 1650, w: 420, h: 100, kind: "button", label: "key_classic_new_switch_diy_key" }
  },
  diy: {
    header: { name: "Header", x: 0, y: 0, w: 1080, h: 140, kind: "header", text: "CUSTOMIZE" },
    title: { name: "Title", x: 80, y: 190, w: 920, h: 130, kind: "text", label: "key_diy_new_slogan_key" },
    options: { name: "Options", x: 80, y: 390, w: 920, h: 1040, kind: "cards", text: "OPTION" },
    price: { name: "Total price", x: 300, y: 1490, w: 480, h: 100, kind: "text", text: "TOTAL €3.00" },
    classic: { name: "Classic button", x: 80, y: 1660, w: 380, h: 100, kind: "button", label: "key_diy_new_switch_classic_key" },
    next: { name: "Next button", x: 620, y: 1660, w: 380, h: 100, kind: "button", label: "key_diy_new_next_key" }
  },
  order: {
    header: { name: "Header", x: 0, y: 0, w: 1080, h: 140, kind: "header", label: "order_new_top" },
    title: { name: "Title", x: 80, y: 190, w: 920, h: 130, kind: "text", label: "order_new_slogan" },
    summary: { name: "Order summary", x: 80, y: 360, w: 920, h: 760, kind: "cards", text: "ORDER ITEM" },
    cups: { name: "Cup selector", x: 80, y: 1170, w: 920, h: 250, kind: "cards", text: "CUP" },
    total: { name: "Total", x: 200, y: 1490, w: 680, h: 120, kind: "text", text: "TOTAL €3.00" },
    back: { name: "Back button", x: 80, y: 1670, w: 360, h: 100, kind: "button", text: "BACK" },
    pay: { name: "Pay button", x: 640, y: 1670, w: 360, h: 100, kind: "button", text: "PAY NOW" }
  },
  payment: {
    title: { name: "Instructions", x: 100, y: 230, w: 880, h: 180, kind: "text", text: "COMPLETE PAYMENT" },
    provider: { name: "Payment provider", x: 140, y: 500, w: 800, h: 760, kind: "cards", text: "PAYMENT" },
    cancel: { name: "Cancel button", x: 315, y: 1650, w: 450, h: 100, kind: "button", text: "CANCEL" }
  },
  warning: {
    title: { name: "Message", x: 100, y: 520, w: 880, h: 260, kind: "text", label: "error_new_content" },
    details: { name: "Error details", x: 150, y: 850, w: 780, h: 180, kind: "text", text: "Please contact support" },
    action: { name: "Action button", x: 315, y: 1600, w: 450, h: 100, kind: "button", text: "TRY AGAIN" }
  },
  outing: {
    header: { name: "Header", x: 0, y: 0, w: 1080, h: 140, kind: "header", label: "process_new_top" },
    title: { name: "Status", x: 100, y: 230, w: 880, h: 220, kind: "text", label: "process_new_slogan" },
    product: { name: "Product image", x: 280, y: 500, w: 520, h: 520, kind: "image", text: "PRODUCT" },
    steps: { name: "Progress steps", x: 160, y: 1120, w: 760, h: 420, kind: "steps" },
    spoon: { name: "Spoon reminder", x: 100, y: 1650, w: 880, h: 120, kind: "text", label: "process_new_bottom" }
  }
};

for (const [screen, layers] of Object.entries(layerDefaults)) {
  state.layouts[screen] = JSON.parse(JSON.stringify(layers));
  Object.values(state.layouts[screen]).forEach((layer, index) => { layer.z = index + 1; });
}

function buildEditor() {
  for (const [id, screen] of Object.entries(screens)) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.textContent = screen.name;
    tab.dataset.screen = id;
    tab.addEventListener("click", () => activate(id));
    $("screen-tabs").append(tab);

    const section = document.createElement("section");
    section.id = `fields-${id}`;
    section.className = "screen-fields";
    section.hidden = id !== state.active;
    section.innerHTML = `${screen.labels ? `<fieldset class="field-grid"><legend>${screen.name} wording</legend>${screen.labels.map(([key, label, value]) => `<label>${label}<input data-label="${key}" type="text" value="${value}" maxlength="120"></label>`).join("")}</fieldset>` : ""}<fieldset class="field-grid"><legend>${screen.name} media</legend>${screen.images.map(([key, label, accept]) => `<label class="wide">${label}<input id="${key}" data-resource="${key}" type="file" accept="${accept || "image/png,image/jpeg,image/webp"}"></label>`).join("")}<p class="hint">Optional. Unset files continue using the app's backend data or original New-theme artwork.</p></fieldset><fieldset class="field-grid"><legend>${screen.name} colors</legend>${screen.colors.map(([key, label]) => { const color = defaultColor(key); return `<label>${label}<span class="color-control"><input id="${key}-${id}" data-resource="${key}" type="color" value="${color}"><input data-color-text="${key}" type="text" value="${color}" pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" maxlength="9" spellcheck="false"></span></label>`; }).join("")}</fieldset>`;
    $("screen-fields").append(section);
  }
  document.querySelectorAll("[data-resource]").forEach((input) => input.addEventListener("input", () => {
    if (input.type === "file" && input.files[0]) {
      try {
        validateMediaFile(input);
        $("message").textContent = "";
      } catch (error) {
        input.value = "";
        $("message").textContent = error instanceof Error ? error.message : "Invalid media file.";
      }
    }
    if (input.type === "color") {
      document.querySelectorAll(`[data-resource="${input.dataset.resource}"]`).forEach((peer) => { peer.value = input.value; });
      document.querySelectorAll(`[data-color-text="${input.dataset.resource}"]`).forEach((peer) => { peer.value = input.value; });
    }
    updatePreview();
  }));
  document.querySelectorAll("[data-color-text]").forEach((input) => input.addEventListener("input", () => {
    if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(input.value)) return;
    document.querySelectorAll(`[data-resource="${input.dataset.colorText}"]`).forEach((peer) => { peer.value = input.value.slice(0, 7); });
    document.querySelectorAll(`[data-color-text="${input.dataset.colorText}"]`).forEach((peer) => { peer.value = input.value; });
    updatePreview();
  }));
  document.querySelectorAll("[data-label]").forEach((input) => input.addEventListener("input", updatePreview));
  activate(state.active);
}

function defaultColor(key) {
  if (key.includes("primary")) return "#d94d82";
  if (key.includes("btn") && key.includes("text")) return "#ffffff";
  return "#16213a";
}

function validateMediaFile(input) {
  const file = input.files[0];
  if (!file) return null;
  const extension = (file.name.match(/\.[a-zA-Z0-9]+$/) || [""])[0].toLowerCase();
  const expectedType = MEDIA_TYPES[extension];
  const isPromotion = input.dataset.resource === "ui_new_welcome_promotion";
  if (!expectedType || (expectedType === "video/mp4" && !isPromotion) || (file.type && file.type !== expectedType)) {
    throw new Error(`${input.dataset.resource} must be a PNG, JPEG, or WebP image${isPromotion ? ", or an MP4 video" : ""}.`);
  }
  const maximum = isPromotion ? 80 : 15;
  if (file.size > maximum * 1024 * 1024) throw new Error(`${input.dataset.resource} exceeds ${maximum} MB.`);
  return extension;
}

function activate(id) {
  state.active = id;
  state.selected = Object.keys(state.layouts[id])[0];
  document.querySelectorAll("#screen-tabs button").forEach((tab) => tab.classList.toggle("active", tab.dataset.screen === id));
  document.querySelectorAll(".screen-fields").forEach((section) => { section.hidden = section.id !== `fields-${id}`; });
  updatePreview();
}

function resourceInput(key, type, screen = state.active) {
  return [...document.querySelectorAll(`#fields-${screen} [data-resource="${key}"]`)].find((input) => input.type === type);
}

function updatePreview() {
  const screen = screens[state.active];
  const primary = resourceInput("color_new_common_primary", "color")?.value || "#d94d82";
  const text = [...document.querySelectorAll(`#fields-${state.active} input[type="color"]`)].find((input) => !input.dataset.resource.includes("primary"))?.value || "#16213a";
  const backgroundKey = screen.images.find(([key]) => key.includes("page_bg"))?.[0];
  const backgroundFile = backgroundKey && resourceInput(backgroundKey, "file")?.files[0];
  const preview = $("preview");
  preview.style.backgroundColor = "#fff8f4";
  preview.style.backgroundImage = backgroundFile ? `url(${previewUrl(backgroundKey, backgroundFile)})` : "none";
  preview.style.color = text;
  $("preview-screen").textContent = screen.name.toUpperCase();
  preview.innerHTML = "";
  const layers = Object.entries(state.layouts[state.active]).sort((a, b) => (a[1].z || 0) - (b[1].z || 0));
  for (const [id, layer] of layers) {
    if (layer.visible === false) continue;
    const element = document.createElement("div");
    element.className = `layout-layer ${layer.kind} ${state.selected === id ? "selected" : ""}`;
    element.dataset.layer = id;
    setLayerGeometry(element, layer);
    element.style.fontSize = `${(layer.fontSize || defaultFontSize(layer)) * preview.clientWidth / 1080}px`;
    element.style.color = layer.color || text;
    element.style.opacity = layer.opacity ?? 1;
    element.style.transform = `rotate(${layer.rotation || 0}deg)`;
    element.style.borderRadius = `${(layer.radius || (layer.kind === "button" ? 100 : 0)) * preview.clientWidth / 1080}px`;
    if (layer.kind === "button" || layer.kind === "header" || layer.kind === "shape") element.style.backgroundColor = layer.fill || primary;
    if (layer.borderColor || layer.kind === "shape") element.style.borderColor = layer.borderColor || layer.color || text;
    element.innerHTML = layerContent(layer, id);
    const handle = document.createElement("span");
    handle.className = "resize-handle";
    element.append(handle);
    element.addEventListener("pointerdown", startLayerPointer);
    element.addEventListener("dblclick", editLayerDirectly);
    preview.append(element);
  }
  updateInspector();
}

function labelValue(key) {
  return document.querySelector(`[data-label="${key}"]`)?.value || "";
}

function layerContent(layer, id) {
  if (layer.media) {
    const file = resourceInput(layer.media, "file", state.active)?.files[0];
    if (file) {
      const url = previewUrl(`${state.active}-${id}`, file);
      return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4")
        ? `<video autoplay muted loop playsinline src="${url}"></video>`
        : `<img src="${url}" alt="">`;
    }
  }
  if (layer.kind === "cards") return `<span>${escapeHtml(layer.text || "ITEM")} 1</span><span>${escapeHtml(layer.text || "ITEM")} 2</span>`;
  if (layer.kind === "steps") return "<span></span><span></span><span></span>";
  if (layer.kind === "shape") return "";
  return escapeHtml(labelValue(layer.label) || layer.text || layer.name);
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function setLayerGeometry(element, layer) {
  element.style.left = `${layer.x / 10.8}%`;
  element.style.top = `${layer.y / 19.2}%`;
  element.style.width = `${layer.w / 10.8}%`;
  element.style.height = `${layer.h / 19.2}%`;
}

function defaultFontSize(layer) { return Math.max(16, Math.min(96, layer.h / 3)); }

function startLayerPointer(event) {
  if (event.currentTarget.contentEditable === "true") return;
  event.preventDefault();
  const id = event.currentTarget.dataset.layer;
  state.selected = id;
  const layer = state.layouts[state.active][id];
  checkpoint();
  state.drag = { id, mode: event.target.classList.contains("resize-handle") ? "resize" : "move", startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y, w: layer.w, h: layer.h };
  document.querySelectorAll(".layout-layer").forEach((item) => item.classList.toggle("selected", item.dataset.layer === id));
  updateInspector();
}

window.addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  const bounds = $("preview").getBoundingClientRect();
  const dx = (event.clientX - state.drag.startX) * 1080 / bounds.width;
  const dy = (event.clientY - state.drag.startY) * 1920 / bounds.height;
  const layer = state.layouts[state.active][state.drag.id];
  if (state.drag.mode === "move") {
    layer.x = clamp(Math.round(state.drag.x + dx), 0, 1080 - layer.w);
    layer.y = clamp(Math.round(state.drag.y + dy), 0, 1920 - layer.h);
  } else {
    layer.w = clamp(Math.round(state.drag.w + dx), 20, 1080 - layer.x);
    layer.h = clamp(Math.round(state.drag.h + dy), 20, 1920 - layer.y);
  }
  setLayerGeometry(document.querySelector(`[data-layer="${state.drag.id}"]`), layer);
  updateInspectorValues(layer);
});
window.addEventListener("pointerup", () => { state.drag = null; });

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function updateInspector() {
  const select = $("layer-select");
  select.innerHTML = Object.entries(state.layouts[state.active]).map(([id, layer]) => `<option value="${id}" ${id === state.selected ? "selected" : ""}>${layer.name}</option>`).join("");
  updateInspectorValues(state.layouts[state.active][state.selected]);
}

function updateInspectorValues(layer) {
  if (!layer) return;
  $("layer-x").value = layer.x;
  $("layer-y").value = layer.y;
  $("layer-width").value = layer.w;
  $("layer-height").value = layer.h;
  $("layer-visible").checked = layer.visible !== false;
  $("layer-font-size").value = Math.round(layer.fontSize || defaultFontSize(layer));
  $("layer-color").value = layer.color || "#16213a";
  $("layer-fill").value = layer.fill || "#d94d82";
  $("layer-radius").value = layer.radius || (layer.kind === "button" ? 100 : 0);
  $("layer-opacity").value = layer.opacity ?? 1;
  $("layer-rotation").value = layer.rotation || 0;
  $("replace-media").hidden = !layer.media;
  $("reset-layer").hidden = !layerDefaults[state.active][state.selected];
  $("replace-background").hidden = !screens[state.active].images.some(([resource]) => resource.includes("page_bg"));
}

$("layer-select").addEventListener("change", (event) => { state.selected = event.target.value; updatePreview(); });
for (const [inputId, property] of [["layer-x", "x"], ["layer-y", "y"], ["layer-width", "w"], ["layer-height", "h"]]) {
  $(inputId).addEventListener("input", (event) => {
    const layer = state.layouts[state.active][state.selected];
    layer[property] = Number(event.target.value);
    layer.w = clamp(layer.w, 20, 1080 - layer.x);
    layer.h = clamp(layer.h, 20, 1920 - layer.y);
    layer.x = clamp(layer.x, 0, 1080 - layer.w);
    layer.y = clamp(layer.y, 0, 1920 - layer.h);
    updatePreview();
  });
}
for (const [inputId, property] of [["layer-font-size", "fontSize"], ["layer-color", "color"], ["layer-fill", "fill"], ["layer-radius", "radius"], ["layer-opacity", "opacity"], ["layer-rotation", "rotation"]]) {
  $(inputId).addEventListener("input", (event) => { state.layouts[state.active][state.selected][property] = inputId.includes("color") || inputId.includes("fill") ? event.target.value : Number(event.target.value); updatePreview(); });
}
document.querySelectorAll(".layout-inspector input").forEach((input) => input.addEventListener("focus", checkpoint));
$("layer-visible").addEventListener("change", (event) => { checkpoint(); state.layouts[state.active][state.selected].visible = event.target.checked; updatePreview(); });
$("reset-layer").addEventListener("click", () => {
  if (!layerDefaults[state.active][state.selected]) return;
  checkpoint();
  state.layouts[state.active][state.selected] = JSON.parse(JSON.stringify(layerDefaults[state.active][state.selected]));
  updatePreview();
});

function editLayerDirectly(event) {
  event.stopPropagation();
  const element = event.currentTarget;
  const layer = state.layouts[state.active][element.dataset.layer];
  if (layer.media) {
    resourceInput(layer.media, "file", state.active)?.click();
    return;
  }
  if (!["text", "button", "header"].includes(layer.kind)) return;
  checkpoint();
  element.contentEditable = "true";
  element.querySelector(".resize-handle")?.remove();
  element.focus();
  const selection = window.getSelection();
  selection.selectAllChildren(element);
  element.addEventListener("input", () => {
    const value = element.textContent.trim();
    if (layer.label) {
      const input = document.querySelector(`[data-label="${layer.label}"]`);
      if (input) input.value = value;
    } else layer.text = value;
  });
  element.addEventListener("blur", () => { element.contentEditable = "false"; updatePreview(); }, { once: true });
}

function checkpoint() {
  const snapshot = JSON.stringify(state.layouts);
  if (state.history[state.history.length - 1] !== snapshot) state.history.push(snapshot);
  if (state.history.length > 30) state.history.shift();
  state.future = [];
}

function restore(snapshot) {
  state.layouts = JSON.parse(snapshot);
  if (!state.layouts[state.active][state.selected]) state.selected = Object.keys(state.layouts[state.active])[0];
  updatePreview();
}

$("undo").addEventListener("click", () => {
  if (!state.history.length) return;
  state.future.push(JSON.stringify(state.layouts));
  restore(state.history.pop());
});
$("redo").addEventListener("click", () => {
  if (!state.future.length) return;
  state.history.push(JSON.stringify(state.layouts));
  restore(state.future.pop());
});

function addLayer(kind) {
  checkpoint();
  const id = `custom_${kind}_${++state.counter}`;
  const z = Math.max(0, ...Object.values(state.layouts[state.active]).map((layer) => layer.z || 0)) + 1;
  state.layouts[state.active][id] = kind === "shape"
    ? { name: "Shape", x: 390, y: 760, w: 300, h: 300, kind, fill: "#d94d82", color: "#16213a", radius: 20, opacity: 1, rotation: 0, custom: true, z }
    : { name: "Text", x: 240, y: 760, w: 600, h: 120, kind, text: "Double-click to edit", color: "#16213a", fontSize: 48, opacity: 1, rotation: 0, custom: true, z };
  state.selected = id;
  updatePreview();
}
$("add-text").addEventListener("click", () => addLayer("text"));
$("add-shape").addEventListener("click", () => addLayer("shape"));
$("duplicate-layer").addEventListener("click", () => {
  checkpoint();
  const source = state.layouts[state.active][state.selected];
  const id = `custom_copy_${++state.counter}`;
  state.layouts[state.active][id] = { ...JSON.parse(JSON.stringify(source)), name: `${source.name} copy`, x: clamp(source.x + 20, 0, 1080 - source.w), y: clamp(source.y + 20, 0, 1920 - source.h), custom: true, z: Math.max(0, ...Object.values(state.layouts[state.active]).map((layer) => layer.z || 0)) + 1 };
  state.selected = id;
  updatePreview();
});
$("delete-layer").addEventListener("click", () => {
  checkpoint();
  const layer = state.layouts[state.active][state.selected];
  if (layer.custom) delete state.layouts[state.active][state.selected]; else layer.visible = false;
  state.selected = Object.keys(state.layouts[state.active])[0];
  updatePreview();
});
$("align-horizontal").addEventListener("click", () => { checkpoint(); const layer = state.layouts[state.active][state.selected]; layer.x = Math.round((1080 - layer.w) / 2); updatePreview(); });
$("align-vertical").addEventListener("click", () => { checkpoint(); const layer = state.layouts[state.active][state.selected]; layer.y = Math.round((1920 - layer.h) / 2); updatePreview(); });
$("layer-up").addEventListener("click", () => { checkpoint(); state.layouts[state.active][state.selected].z++; updatePreview(); });
$("layer-down").addEventListener("click", () => { checkpoint(); state.layouts[state.active][state.selected].z--; updatePreview(); });
$("replace-media").addEventListener("click", () => {
  const layer = state.layouts[state.active][state.selected];
  if (layer.media) resourceInput(layer.media, "file", state.active)?.click();
});
$("replace-background").addEventListener("click", () => {
  const key = screens[state.active].images.find(([resource]) => resource.includes("page_bg"))?.[0];
  if (key) resourceInput(key, "file", state.active)?.click();
});

window.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.contentEditable === "true") return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); (event.shiftKey ? $("redo") : $("undo")).click(); return; }
  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); $("delete-layer").click(); return; }
  const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!movement) return;
  event.preventDefault(); checkpoint();
  const layer = state.layouts[state.active][state.selected], amount = event.shiftKey ? 10 : 1;
  layer.x = clamp(layer.x + movement[0] * amount, 0, 1080 - layer.w);
  layer.y = clamp(layer.y + movement[1] * amount, 0, 1920 - layer.h);
  updatePreview();
});

function previewUrl(key, file) {
  const current = state.imageUrls[key];
  if (current?.file === file) return current.url;
  if (current) URL.revokeObjectURL(current.url);
  const url = URL.createObjectURL(file);
  state.imageUrls[key] = { file, url };
  return url;
}

window.addEventListener("pagehide", () => {
  Object.values(state.imageUrls).forEach(({ url }) => URL.revokeObjectURL(url));
});

$("theme-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("message").textContent = "Building package...";
  try {
    const files = [];
    const resources = {};
    const labels = {};
    const seen = new Set();
    let totalMediaSize = 0;
    const mediaInputs = [...document.querySelectorAll('[data-resource][type="file"]')];
    const uploadedMedia = mediaInputs.filter((input) => input.files[0]).length;
    const missingMedia = mediaInputs.length - uploadedMedia;
    if (missingMedia && !window.confirm(`${uploadedMedia} of ${mediaInputs.length} media slots contain files. The other ${missingMedia} slots will keep the machine's existing Huaxin artwork. Continue?`)) {
      $("message").textContent = "Export cancelled.";
      return;
    }
    for (const input of document.querySelectorAll("[data-resource]")) {
      const key = input.dataset.resource;
      if (input.type === "color") {
        if (!seen.has(key)) resources[key] = input.value;
        seen.add(key);
        continue;
      }
      const file = input.files[0];
      if (!file) continue;
      const extension = validateMediaFile(input);
      totalMediaSize += file.size;
      if (totalMediaSize > MAX_PACKAGE_SIZE) throw new Error("Selected media exceeds the 100 MB package limit.");
      const path = `images/${key}${extension}`;
      resources[key] = path;
      files.push({ name: path, data: new Uint8Array(await file.arrayBuffer()) });
    }
    document.querySelectorAll("[data-label]").forEach((input) => { labels[input.dataset.label] = input.value; });
    const layout = {};
    for (const [screen, layers] of Object.entries(state.layouts)) {
      layout[screen] = {};
      for (const [id, layer] of Object.entries(layers)) {
        layout[screen][id] = {
          type: layer.kind,
          x: layer.x, y: layer.y, width: layer.w, height: layer.h,
          visible: layer.visible !== false,
          z: layer.z || 0,
          text: layer.label ? labelValue(layer.label) : layer.text || "",
          fontSize: layer.fontSize || defaultFontSize(layer),
          color: layer.color || "",
          fill: layer.fill || "",
          radius: layer.radius || 0,
          opacity: layer.opacity ?? 1,
          rotation: layer.rotation || 0,
          media: layer.media || ""
        };
      }
    }
    const manifest = { formatVersion: 1, id: $("theme-id").value, name: $("theme-name").value, version: Number($("theme-version").value), template: "new", resources, labels, layout };
    files.unshift({ name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) });
    const blob = makeZip(files);
    if (blob.size > MAX_PACKAGE_SIZE) throw new Error("Complete package exceeds 100 MB");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${manifest.id}-v${manifest.version}.ice-theme`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $("message").textContent = `Exported ${link.download}: ${uploadedMedia} media files, ${missingMedia} Huaxin fallback slots.`;
  } catch (error) { $("message").textContent = error instanceof Error ? error.message : "Unable to export theme."; }
});

function makeZip(files) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), crc = crc32(file.data), local = bytes(30 + name.length);
    write32(local, 0, 0x04034b50); write16(local, 4, 20); write16(local, 6, 0x0800); write32(local, 14, crc); write32(local, 18, file.data.length); write32(local, 22, file.data.length); write16(local, 26, name.length); local.set(name, 30);
    localParts.push(local, file.data);
    const central = bytes(46 + name.length);
    write32(central, 0, 0x02014b50); write16(central, 4, 20); write16(central, 6, 20); write16(central, 8, 0x0800); write32(central, 16, crc); write32(central, 20, file.data.length); write32(central, 24, file.data.length); write16(central, 28, name.length); write32(central, 42, offset); central.set(name, 46);
    centralParts.push(central); offset += local.length + file.data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0), end = bytes(22);
  write32(end, 0, 0x06054b50); write16(end, 8, files.length); write16(end, 10, files.length); write32(end, 12, centralSize); write32(end, 16, offset);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}
function bytes(length) { return new Uint8Array(length); }
function write16(target, offset, value) { new DataView(target.buffer).setUint16(offset, value, true); }
function write32(target, offset, value) { new DataView(target.buffer).setUint32(offset, value >>> 0, true); }
const crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function crc32(data) { let value = 0xffffffff; for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

buildEditor();
