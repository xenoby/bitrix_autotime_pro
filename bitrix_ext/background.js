const INTERVAL_WORK_TIME = 1; 
const INTERVAL_MESSAGES = 0.5; 

// Создаем один будильник, но внутри вызываем разные функции
chrome.alarms.create("alarmWorkTime", { periodInMinutes: INTERVAL_WORK_TIME });
chrome.alarms.create("alarmMessages", { periodInMinutes: INTERVAL_MESSAGES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "alarmWorkTime") checkWorkTime();
  if (alarm.name === "alarmMessages") checkMessages();
});

// Кнопка "Сохранить" в popup также дергает обе проверки
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_CHECK') {
    checkWorkTime();
    checkMessages();
  }
});

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.query({ url: ["https://*.bitrix24.ru/*",  "https://bitrix24.ru/*"] }, (tabs) => {
    if (tabs.length > 0) {
      // Берем первую найденную вкладку
      const targetTab = tabs[0];
      
      // Сначала делаем активным окно браузера, в котором эта вкладка
      chrome.windows.update(targetTab.windowId, { focused: true });
      
      // Затем делаем активной саму вкладку
      chrome.tabs.update(targetTab.id, { active: true });
    }
  });
});

// --- НОВОЕ: Очистка памяти сообщений при перезагрузке страницы ---
/*
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url && (tab.url.includes('bitrix24.ru') || tab.url.includes('ideal-plm.ru'))) {
    console.log("Страница Битрикса обновляется, сбрасываю список уведомлений...");
    chrome.storage.local.set({ notifiedMsgs: [] });
  }
});
*/

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hrs, mins] = timeStr.split(':').map(Number);
  return hrs * 60 + mins;
}

function showNotify(title, msg, iconUrl = "logo.png") {
  chrome.notifications.create({
    type: "basic",
    iconUrl: iconUrl, 
    title: title,
    message: msg,
    priority: 2
  }, (id) => {
    // Если картинка не скачалась (ошибка в консоли на вашем скриншоте), пробуем еще раз с дефолтной иконкой
    if (chrome.runtime.lastError) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "logo.png",
        title: title,
        message: msg,
        priority: 2
      });
    }
  });
}

// ==========================================
// БЛОК 1: РАБОЧЕЕ ВРЕМЯ
// ==========================================
async function checkWorkTime() {
  chrome.storage.local.get(['startTime', 'stopTime', 'lunchStart', 'lunchEnd', 'selectedDays'], async (res) => {
    const today = new Date().getDay();
    if (!(res.selectedDays || []).includes(today)) return;

    const tabs = await chrome.tabs.query({ url: ["https://*.bitrix24.ru/*", "https://bitrix24.ru/*"] });
    if (!tabs.length) return;

    const settings = {
      start: timeToMinutes(res.startTime || "8:00"),
      lunchS: timeToMinutes(res.lunchStart || "12:00"),
      lunchE: timeToMinutes(res.lunchEnd || "13:00"),
      stop: timeToMinutes(res.stopTime || "17:00")
    };

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id, allFrames: true },
      world: "MAIN", 
      func: bitrixLogicTime,
      args: [settings]
    }).then(results => {
      const data = results.find(r => r.result && r.result.action)?.result; 
	  
	  if (data && data.action === 'weekly_report') {
        showNotify("Bitrix Report", "Пора заполнить недельный отчет! 📝");        
      }
	  
      if (data && data.action !== 'none') {
        const labels = {
          'day_start': "Рабочий день начат! 🚀",
          'lunch_break': "Ушли на обед 🍕",
          'reopen': "Работа возобновлена 💻",
          'day_end': "Рабочий день завершен! ✅"
        };
        //showNotify("Bitrix Time", labels[data.action]);
        //chrome.storage.local.set({ lastAction: `${labels[data.action]} (${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})` });
		
		const message = labels[data.action];
		
		if (message) {
			showNotify("Bitrix Time", message);
			// Записываем в лог только если сообщение существует
			chrome.storage.local.set({ 
				lastAction: `${message} (${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})` 
			});
		}
      }
    });
  });
}

function bitrixLogicTime(s) {
	
  // 1. ПРОВЕРКА НЕДЕЛЬНОГО ОТЧЕТА (по вашему скриншоту)
  // Ищем окно, ID которого начинается на timeman_weekly_report_popup
  const reportPopup = document.querySelector('[id^="timeman_weekly_report_popup"]') || 
                      document.querySelector('.popup-window-with-titlebar.--open');

  if (reportPopup && reportPopup.innerText.includes('отчет')) {
    return { action: 'weekly_report' };
  }
  
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();

  const getStatus = () => {
    const txt = document.querySelector('.tm-timer__title')?.innerText.toLowerCase() || "";
    if (txt.includes('завершен') || txt.includes('завершён')) return 'CLOSED';
    if (txt.includes('работаю')) return 'OPENED';
    return 'UNKNOWN';
  };

  const smartClick = (target) => {
    const icon = document.querySelector('.air-user-profile-avatar__work-time-state') || document.querySelector('.work-time-state');
    if (!icon) return false;
    icon.click();
    let attempts = 0;
    const timer = setInterval(() => {
      let btn = null;
      if (target === 'close') {
        btn = document.getElementById('buttonStopText') || document.querySelector('button[title*="Завершить"]');
      } else {
        btn = document.getElementById('buttonStartDropdownAnchorText') || document.getElementById('buttonStartText');
        if (!btn) {
          const btns = document.querySelectorAll('button, .ui-btn');
          for (let b of btns) {
            const t = b.innerText.toLowerCase();
            if (t.includes('начать') || t.includes('возобновить') || t.includes('продолжить')) { btn = b; break; }
          }
        }
      }
      if (btn && btn.offsetWidth > 0) {
        btn.click();
        clearInterval(timer);
        setTimeout(() => { if(document.querySelector('.ui-popup-menu')) icon.click(); }, 1500);
      }
      if (++attempts > 10) clearInterval(timer);
    }, 500);
    return true;
  };

  const status = getStatus();
  let action = 'none';

  if (cur >= s.start && cur < s.lunchS && status !== 'OPENED') { if(smartClick('open')) action = 'day_start'; }
  else if (cur >= s.lunchS && cur < s.lunchE && status === 'OPENED') { if(smartClick('close')) action = 'lunch_break'; }
  else if (cur >= s.lunchE && cur < s.stop && status !== 'OPENED') { if(smartClick('open')) action = 'reopen'; }
  else if (cur >= s.stop && status === 'OPENED') { if(smartClick('close')) action = 'day_end'; }

  return { action, status };
}

// ==========================================
// БЛОК 2: СООБЩЕНИЯ
// ==========================================
async function checkMessages() {
  const tabs = await chrome.tabs.query({ url: ["https://*.bitrix24.ru/*", "https://bitrix24.ru/*"] });
  if (!tabs.length) return;

  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id, allFrames: true },
    world: "MAIN", 
    func: bitrixLogicMsg
  }).then(results => {
    const data = results.find(r => r.result && r.result.messages)?.result;
    if (data && data.messages.length > 0) {
      chrome.storage.local.get(['notifiedMsgs'], (res) => {
        let notified = res.notifiedMsgs || [];
        data.messages.forEach(m => {
          if (!notified.includes(m.id)) {
            showNotify(`Чат: ${m.author}`, m.text, m.avatar || "logo.png");
            notified.push(m.id);
          }
        });
        chrome.storage.local.set({ notifiedMsgs: notified.slice(-50) });
      });
    }
  });
}

function bitrixLogicMsg() {
  const messages = [];
  try {
    // Ищем все активные счетчики в списке чатов
    const counters = document.querySelectorAll('.bx-im-list-recent-item__counter_number');
    
    counters.forEach(cnt => {
      const val = parseInt(cnt.innerText);
      if (val > 0) {
        const item = cnt.closest('.bx-im-list-recent-item__wrap');
        if (item) {
          const author = item.querySelector('.bx-im-chat-title__text')?.innerText || "Кто-то";
          const text = item.querySelector('.bx-im-list-recent-item__message_text')?.innerText || "Новое сообщение";
		  
		  let avatarUrl = null;
          const img = item.querySelector('.bx-im-avatar__content img');
          if (img && img.src && img.src.startsWith('http')) {
            avatarUrl = img.src;
          }
		  
          // Генерируем уникальный ID для этого сообщения
          const id = item.getAttribute('data-id') + "_" + text;
          messages.push({ 
            id, 
            author: author.trim(), 
            text: text.trim().substring(0, 70),
            avatar: avatarUrl 
          });
        }
      }
    });
  } catch (e) {}
  return { messages };
}
