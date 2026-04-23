const INTERVAL_WORK = 1;
const INTERVAL_MSG = 0.5;
const INTERVAL_REPORTS = 10;

// Создаём будильники
chrome.alarms.create("workAlarm", { periodInMinutes: INTERVAL_WORK });
chrome.alarms.create("msgAlarm", { periodInMinutes: INTERVAL_MSG });
chrome.alarms.create("reportAlarm", { periodInMinutes: INTERVAL_REPORTS });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "workAlarm") checkWorkTime();
  if (alarm.name === "msgAlarm") checkMessages();
  if (alarm.name === "reportAlarm") checkWeeklyReports();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_CHECK') { 
	checkWorkTime(); 
	checkMessages(); 
	checkWeeklyReports();
  }
});

// ==========================================
// КЛИК ПО УВЕДОМЛЕНИЮ — ОТКРЫТИЕ БИТРИКСА
// ==========================================
chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.query({ url: ["https://*.bitrix24.ru/*", "https://bitrix24.ru/*"] }, (tabs) => {
    if (tabs.length > 0) {
      // Открываем существующую вкладку
      const targetTab = tabs[0];
      chrome.windows.update(targetTab.windowId, { focused: true });
      chrome.tabs.update(targetTab.id, { active: true });
    } else {
      // Если вкладок нет — открываем новую
      chrome.tabs.create({ url: "https://bitrix24.ru/" });
    }
  });
});

// Универсальный запрос к Bitrix API
async function bxFetch(method, params = {}) {
  const { webhookUrl } = await chrome.storage.local.get("webhookUrl");
  if (!webhookUrl) throw new Error("Webhook URL не настроен в popup");
  
  const url = webhookUrl.replace(/\/+$/, "") + `/${method}.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error_description}`);
  return data;
}

// ==========================================
// БЛОК 1: РАБОЧЕЕ ВРЕМЯ
// ==========================================
async function checkWorkTime() {
  try {
    const { selectedDays, startTime, stopTime, lunchStart, lunchEnd } = await chrome.storage.local.get([
      "selectedDays", "startTime", "stopTime", "lunchStart", "lunchEnd"
    ]);
    
    const today = new Date().getDay();
    const workDays = selectedDays || [1,2,3,4,5];
    if (!workDays.includes(today)) return;

    const statusData = await bxFetch("timeman.status");
    const currentStatus = statusData?.result?.STATUS || "UNKNOWN";
    
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const parse = t => (t || "00:00").split(":").reduce((a, b) => a * 60 + (+b), 0);

    const s = parse(startTime), ls = parse(lunchStart), le = parse(lunchEnd), st = parse(stopTime);
    let actionMethod = null;
    let notifyMsg = null;

    if (cur >= s && cur < ls && currentStatus !== "OPENED") {
      actionMethod = "timeman.open"; notifyMsg = "Рабочий день начат 🚀";
    } 
    else if (cur >= ls && cur < le && !["PAUSED","CLOSED"].includes(currentStatus)) {
      actionMethod = "timeman.pause"; notifyMsg = "Пауза на обед 🍕";
    }
    else if (cur >= le && cur < st && currentStatus !== "OPENED") {
      actionMethod = "timeman.open"; notifyMsg = "Работа возобновлена 💻";
    }
    else if (cur >= st && currentStatus !== "CLOSED") {
      actionMethod = "timeman.close"; notifyMsg = "День завершен ✅";
    }

    if (actionMethod) {
      await bxFetch(actionMethod);
      showNotify("Bitrix Time", notifyMsg);
      chrome.storage.local.set({ 
        lastAction: `${notifyMsg} (${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})})` 
      });
    }
  } catch (e) { console.error("❌ WorkTime:", e.message); }
}

// ==========================================
// БЛОК 2: СООБЩЕНИЯ (с проверкой обеда)
// ==========================================
/*
async function checkMessages() {
  try {
    const { muteDuringLunch, lunchStart, lunchEnd } = await chrome.storage.local.get([
      "muteDuringLunch", "lunchStart", "lunchEnd"
    ]);
    
    // Проверка: сейчас обед и включена опция "Не беспокоить"?
    if (muteDuringLunch) {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      const parse = t => (t || "00:00").split(":").reduce((a, b) => a * 60 + (+b), 0);
      
      const ls = parse(lunchStart);
      const le = parse(lunchEnd);
      
      if (cur >= ls && cur < le) {
        console.log("🔕 Обеденное время — уведомления отключены");
        return; // Пропускаем проверку сообщений
      }
    }

    // Быстрая проверка счётчиков
    const counters = await bxFetch("im.counters.get");
    const chatUnread = counters?.result?.CHAT || {};
    
    const hasUnread = Object.values(chatUnread).some(c => c > 0);
    if (!hasUnread) return;

    // Получаем детали диалогов
    const recent = await bxFetch("im.recent.list", { FILTER: { UNREAD: "Y" } });
    const items = recent?.result?.items || [];
    if (!items.length) return;

    // Загружаем историю уведомлений
    const { notifiedMsgs = [] } = await chrome.storage.local.get("notifiedMsgs");
    const newNotified = [];

    // Обрабатываем новые сообщения
    for (const item of items) {
      const msgId = `${item.id}_${item.message?.id}`;
      if (notifiedMsgs.includes(msgId)) continue;
      
      const title = item.title || "Чат";
      const text = item.message?.text?.substring(0, 100) || "Новое сообщение";
      const author = item.user?.name || item.chat?.name || "";
      const avatar = item.user?.avatar || item.avatar?.url || "bitrix.png";
      
      showNotify(author ? `💬 ${author}: ${title}` : `💬 ${title}`, text, avatar);
      newNotified.push(msgId);
    }

    // Сохраняем историю (последние 100)
    if (newNotified.length) {
      await chrome.storage.local.set({ 
        notifiedMsgs: [...notifiedMsgs, ...newNotified].slice(-100) 
      });
    }
  } catch (e) { console.error("❌ Messages:", e.message); }
}
*/

async function checkMessages() {
  try {
    const { muteDuringLunch, lunchStart, lunchEnd } = await chrome.storage.local.get([
      "muteDuringLunch", "lunchStart", "lunchEnd"
    ]);
    
    // Проверка обеда
    if (muteDuringLunch) {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      const parse = t => (t || "00:00").split(":").reduce((a, b) => a * 60 + (+b), 0);
      const ls = parse(lunchStart), le = parse(lunchEnd);
      
      if (cur >= ls && cur < le) {
        console.log("🔕 Обед — уведомления отключены");
        return;
      }
    }

    // 1. Получаем счётчики
    const counters = await bxFetch("im.counters.get");
    console.log("📡 Counters:", counters?.result);
    
    // 2. Проверяем ВСЕ типы непрочитанных (CHAT, DIALOG, MESSENGER, COLLAB)
    const unreadTypes = ['CHAT', 'DIALOG', 'MESSENGER', 'COLLAB'];
    let hasUnread = false;
    
    for (const type of unreadTypes) {
      const typeData = counters?.result?.[type] || {};
      if (Object.values(typeData).some(c => c > 0)) {
        hasUnread = true;
        console.log(`📬 Unread in ${type}:`, typeData);
        break;
      }
    }
    
    if (!hasUnread) {
      console.log("✅ Нет непрочитанных ни в одном типе");
      return;
    }

    // 3. Получаем список диалогов (без фильтра — фильтруем вручную)
    const recent = await bxFetch("im.recent.list");
    console.log("📡 Recent items count:", recent?.result?.items?.length);
    
    // Фильтруем только те, где counter > 0
    const items = (recent?.result?.items || [])
      .filter(item => item.counter > 0);
    
    if (!items.length) {
      console.log("✅ Нет активных диалогов с непрочитанными");
      return;
    }

    // 4. Обработка новых сообщений
    const { notifiedMsgs = [] } = await chrome.storage.local.get("notifiedMsgs");
    const newNotified = [];

    for (const item of items) {
      const msgId = `${item.id}_${item.message?.id}`;
      console.log("📨 Processing:", { id: item.id, msgId, counter: item.counter });
      
      if (notifiedMsgs.includes(msgId)) {
        console.log("⏭️ Уже уведомлено:", msgId);
        continue;
      }
      
      const title = item.title || "Чат";
      const text = item.message?.text?.substring(0, 100) || "Новое сообщение";
      const author = item.user?.name || item.chat?.name || "";
      const avatar = item.user?.avatar || item.avatar?.url || "bitrix.png";
      
      console.log("🔔 Showing notify:", { title, author, text });
      showNotify(author ? `💬 ${author}: ${title}` : `💬 ${title}`, text, avatar);
      newNotified.push(msgId);
    }

    // 5. Сохраняем историю
    if (newNotified.length) {
      await chrome.storage.local.set({ 
        notifiedMsgs: [...notifiedMsgs, ...newNotified].slice(-100) 
      });
      console.log(`✅ Saved ${newNotified.length} new message IDs`);
    }
    
  } catch (e) { 
    console.error("❌ Messages error:", e.message, e); 
  }
}

// ==========================================
// БЛОК 3: НЕДЕЛЬНЫЕ ОТЧЁТЫ
// ==========================================
async function checkWeeklyReports() {
  try {
    const res = await bxFetch("im.notify.get", { CHAT_ID: 0 }); // 0 = личные уведомления
    const notifications = res?.result?.notifications || [];
    
    // Фильтруем только непрочитанные отчёты по тайм-менеджменту
    const reports = notifications.filter(n => 
      n.notify_module === "timeman" &&
      (n.notify_event === "report_approve" || n.notify_event === "report_comment") &&
      n.notify_read !== "Y"
    );

    if (!reports.length) return;

    const { notifiedReports = [] } = await chrome.storage.local.get("notifiedReports");
    const newReports = [];

    for (const report of reports) {
      if (notifiedReports.includes(report.id)) continue;
      
      // Извлекаем период из текста или тега
      const periodMatch = report.text.match(/\[.*?\](.*?)\[\/URL\]/);
      const period = periodMatch ? periodMatch[1] : "Недельный отчёт";
      const status = report.notify_event === "report_approve" ? "✅ Утверждён" : "💬 Комментарий";
      
      showNotify("Bitrix Отчёт", `${status}: ${period}`);
      newReports.push(report.id);
    }

    if (newReports.length) {
      await chrome.storage.local.set({ 
        notifiedReports: [...notifiedReports, ...newReports].slice(-50) 
      });
    }
  } catch (e) { console.error("❌ Reports check failed:", e.message); }
}

// ==========================================
// УВЕДОМЛЕНИЯ
// ==========================================
function showNotify(title, msg, icon = "bitrix.png") {
  chrome.notifications.create({ 
    type: "basic", 
    iconUrl: icon, 
    title, 
    message: msg, 
    priority: 2 
  });
}

