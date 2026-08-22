const STORAGE_KEY = "questionQueueItems";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "qq-capture-selection",
    title: "记录为追问：%s",
    contexts: ["selection"]
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) sendToTab(tab.id, { type: "QQ_TOGGLE" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-question-queue") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) sendToTab(tab.id, { type: "QQ_TOGGLE" });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "qq-capture-selection" || !tab?.id) return;
  sendToTab(tab.id, {
    type: "QQ_CAPTURE",
    selection: info.selectionText || ""
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) updateBadge();
});

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // The current page is outside the supported model sites.
  });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const count = items.filter((item) => item.status === "pending").length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6D5EF7" });
}
