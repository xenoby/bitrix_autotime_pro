const fields = ['startTime', 'stopTime', 'lunchStart', 'lunchEnd', 'webhookUrl'];
let selectedDays = [1, 2, 3, 4, 5];

// Загрузка настроек
chrome.storage.local.get([...fields, 'selectedDays', 'lastAction', 'muteDuringLunch'], (res) => {
  fields.forEach(f => { if (res[f]) document.getElementById(f).value = res[f]; });
  if (res.selectedDays) selectedDays = res.selectedDays;
  if (res.lastAction) document.getElementById('lastLog').textContent = res.lastAction;
  if (res.muteDuringLunch) document.getElementById('muteDuringLunch').checked = true;
  
  // Визуально активируем кнопки дней
  document.querySelectorAll('.day-btn').forEach(btn => {
    if (selectedDays.includes(parseInt(btn.dataset.day))) btn.classList.add('active');
  });
});

// Клик по дню
document.querySelectorAll('.day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const day = parseInt(btn.dataset.day);
    if (selectedDays.includes(day)) {
      selectedDays = selectedDays.filter(d => d !== day);
      btn.classList.remove('active');
    } else {
      selectedDays.push(day);
      btn.classList.add('active');
    }
  });
});

// Сохранение
document.getElementById('save').addEventListener('click', () => {
  const data = { 
    selectedDays,
    muteDuringLunch: document.getElementById('muteDuringLunch').checked
  };
  fields.forEach(f => data[f] = document.getElementById(f).value);
  
  if (!data.webhookUrl || !data.webhookUrl.includes('/rest/')) {
    alert('⚠️ Введите корректный Webhook URL (должен содержать /rest/)');
    return;
  }
  
  chrome.storage.local.set(data, () => {
    document.getElementById('save').textContent = 'Сохранено! ✅';
    chrome.runtime.sendMessage({ type: 'START_CHECK' });
    setTimeout(() => { document.getElementById('save').textContent = 'Сохранить всё'; }, 1500);
  });
});