/* ARUUM STUDIO Mini App.
   Шаги, варианты, тексты и портфолио приходят только из steps.json
   (собирается из bot/steps.py скриптом scripts/export_steps.py). */
(function () {
  'use strict';

  var PAYLOAD_VERSION = 1;
  var LINK_DELAY_MS = 1800; // успеть прочитать «нажмите Старт» перед возвратом в чат
  var SEND_DELAY_MS = 600; // sendData закрывает Mini App, поэтому экран благодарности показываем до отправки
  var BRAND = {
    dark: { bg: '#1a1613', accent: '#dcc6a4', ink: '#1a1613' },
    light: { bg: '#f5efe4', accent: '#7f6037', ink: '#fffaf1' }
  };

  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  // В обычном браузере скрипт Telegram тоже создаёт объект, но с platform "unknown".
  // Старые клиенты (Bot API < 6.4) platform не сообщают, поэтому смотрим и на параметры запуска.
  var launchedByTelegram = /tgWebApp(Version|Data|Platform)=/.test(window.location.hash);
  var inTelegram = Boolean(tg && ((tg.platform && tg.platform !== 'unknown') || launchedByTelegram));
  var root = document.getElementById('app');

  var data = null;
  var lang = 'ru';
  var state = { screen: 'welcome', step: 0, answers: {}, sent: false, undelivered: false, viaLink: false };

  // ---------- маленькие помощники ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i += 1) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function t(key) {
    return data.texts[lang][key] || key;
  }

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return name in values ? values[name] : match;
    });
  }

  function supports(version) {
    return Boolean(inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast(version));
  }

  function haptic(kind) {
    if (!supports('6.1') || !tg.HapticFeedback) return;
    if (kind === 'select') tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.impactOccurred('light');
  }

  // ---------- язык и тема ----------

  function detectLang() {
    var fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (data.langs.indexOf(fromUrl) !== -1) return fromUrl;
    var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    var code = user && user.language_code ? String(user.language_code).slice(0, 2) : '';
    return data.langs.indexOf(code) !== -1 ? code : data.default_lang;
  }

  function scheme() {
    if (inTelegram && tg.colorScheme) return tg.colorScheme === 'light' ? 'light' : 'dark';
    var forced = new URLSearchParams(window.location.search).get('scheme');
    return forced === 'light' ? 'light' : 'dark';
  }

  function applyTheme() {
    var current = scheme();
    var brand = BRAND[current];
    document.documentElement.dataset.scheme = current;
    try {
      // произвольный цвет шапки принимается с Bot API 6.9, до этого — только ключевые слова
      if (supports('6.9')) tg.setHeaderColor(brand.bg);
      else if (supports('6.1')) tg.setHeaderColor('secondary_bg_color');
      if (supports('6.1')) tg.setBackgroundColor(brand.bg);
      if (supports('7.10')) tg.setBottomBarColor(brand.bg);
      if (inTelegram) tg.MainButton.setParams({ color: brand.accent, text_color: brand.ink });
    } catch (error) {
      window.console.warn(error); // оформление не должно мешать анкете
    }
  }

  // ---------- навигация ----------

  function go(screen, step) {
    state.screen = screen;
    if (step !== undefined) state.step = step;
    render();
  }

  function back() {
    if (state.screen === 'wizard') {
      if (state.step === 0) go('welcome');
      else go('wizard', state.step - 1);
    } else if (state.screen === 'portfolio') {
      go('wizard', data.steps.length - 1);
    } else if (state.screen === 'summary') {
      go('portfolio');
    }
  }

  function nextStep() {
    if (state.step + 1 < data.steps.length) go('wizard', state.step + 1);
    else go('portfolio');
  }

  function isComplete() {
    return data.steps.every(function (step) { return state.answers[step.id] !== undefined; });
  }

  // ---------- отправка ----------

  function payload() {
    return JSON.stringify({ v: PAYLOAD_VERSION, lang: lang, a: state.answers });
  }

  /** Ссылка t.me/<бот>?start=<заявка>: путь без сервера, когда sendData недоступен (кнопка меню). */
  function startLink() {
    var bot = new URLSearchParams(window.location.search).get('bot');
    if (!bot || !/^[A-Za-z0-9_]{3,40}$/.test(bot) || !data.start) return null;
    var parts = [data.start.prefix, lang].concat(data.steps.map(function (step) {
      return String(state.answers[step.id]);
    }));
    return 'https://t.me/' + bot + '?start=' + encodeURIComponent(parts.join(data.start.separator));
  }

  function submit() {
    if (state.sent || !isComplete()) return;
    var body = payload();
    // initData пустой только при запуске с кнопки клавиатуры — там работает sendData;
    // при запуске из меню ответы уходят боту ссылкой с параметром start
    var link = inTelegram && tg.initData ? startLink() : null;
    state.sent = true;
    state.viaLink = Boolean(link);
    go('thanks');
    if (!inTelegram) {
      // локальный превью: показываем, что ушло бы боту
      window.console.info('[preview] sendData', body);
      root.dataset.sent = body;
      return;
    }
    tg.MainButton.hide();
    window.setTimeout(function () {
      if (supports('6.2')) tg.disableClosingConfirmation();
      if (link) {
        tg.openTelegramLink(link);
        tg.close();
        return;
      }
      tg.sendData(body);
      // если окно не закрылось, заявка не ушла — возвращаем резюме с подсказкой
      window.setTimeout(function () {
        state.sent = false;
        state.undelivered = true;
        go('summary');
      }, 2500);
    }, link ? LINK_DELAY_MS : SEND_DELAY_MS);
  }

  function syncTelegramChrome() {
    if (!inTelegram) return;
    var onSummary = state.screen === 'summary';
    if (onSummary) {
      tg.MainButton.setText(t('submit'));
      tg.MainButton.show();
    } else {
      tg.MainButton.hide();
    }
    if (supports('6.1')) {
      var canGoBack = state.screen === 'wizard' || state.screen === 'portfolio' || onSummary;
      if (canGoBack) tg.BackButton.show();
      else tg.BackButton.hide();
    }
    if (supports('6.2') && Object.keys(state.answers).length && state.screen !== 'thanks') {
      tg.enableClosingConfirmation();
    }
  }

  // ---------- экраны ----------

  function brandBlock() {
    var name = el('span', 'brand-name', t('brand'));
    add(name, el('span', 'brand-tag', t('tagline')));
    return add(el('div', 'brand'), el('span', 'brand-mark', 'A'), name);
  }

  function button(className, label, onClick) {
    var node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function welcomeScreen() {
    var start = button('btn', t('start'), function () { haptic(); go('wizard', 0); });
    var copy = add(el('div', 'welcome-copy'), el('h1', 'welcome-title', t('welcome')), start);
    var arch = el('div', 'arch');
    arch.setAttribute('aria-hidden', 'true');
    return add(el('section', 'screen welcome'), brandBlock(), add(el('div', 'welcome-body'), copy, arch));
  }

  function topbar(label) {
    var bar = add(el('div', 'topbar'), el('span', 'eyebrow', label));
    add(bar, button('btn-ghost', t('back'), function () { haptic(); back(); }));
    return bar;
  }

  function progress(current, total) {
    var bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '1');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(current));
    for (var i = 1; i <= total; i += 1) add(bar, el('span', i <= current ? 'is-done' : ''));
    return bar;
  }

  function optionsBlock(step) {
    var list = el('div', 'options');
    step.options.forEach(function (option) {
      var selected = state.answers[step.id] === option.id;
      var node = button('option' + (selected ? ' is-selected' : ''), option.label[lang], function () {
        state.answers[step.id] = option.id;
        haptic('select');
        nextStep();
      });
      node.setAttribute('aria-pressed', String(selected));
      add(list, node);
    });
    return list;
  }

  function sliderBlock(step) {
    var spec = step.slider;
    var stored = state.answers[step.id];
    var value = typeof stored === 'number' ? stored : spec.default;
    state.answers[step.id] = value;

    // крупная цифра — поле ввода: можно набрать точное значение
    var number = el('input', 'slider-input');
    number.type = 'number';
    number.inputMode = 'numeric';
    number.min = String(spec.min);
    number.max = String(spec.max);
    number.step = String(spec.step);
    number.setAttribute('aria-label', step.title[lang]);
    var big = add(el('div', 'slider-value'), number, el('span', 'slider-unit', spec.unit[lang]));

    var range = el('input', 'range');
    range.type = 'range';
    range.min = String(spec.min);
    range.max = String(spec.max);
    range.step = String(spec.step);
    range.setAttribute('aria-label', step.title[lang]);

    function set(next, keepTyping) {
      var rounded = Math.round(next / spec.step) * spec.step;
      var clamped = Math.min(spec.max, Math.max(spec.min, rounded));
      var changed = clamped !== state.answers[step.id];
      state.answers[step.id] = clamped;
      range.value = String(clamped);
      range.setAttribute('aria-valuetext', clamped + ' ' + spec.unit[lang]);
      if (!keepTyping) number.value = String(clamped);
      range.style.setProperty('--fill', ((clamped - spec.min) / (spec.max - spec.min)) * 100 + '%');
      if (changed) haptic('select');
    }

    range.addEventListener('input', function () { set(Number(range.value)); });
    // пока человек печатает, цифру в поле не трогаем; на выходе из поля приводим к диапазону
    number.addEventListener('input', function () {
      var typed = Number(number.value);
      if (number.value !== '' && isFinite(typed)) set(typed, true);
    });
    number.addEventListener('change', function () { set(state.answers[step.id]); });
    number.addEventListener('focus', function () { number.select(); });
    var minus = button('nudge', '−', function () { set(state.answers[step.id] - spec.step); });
    var plus = button('nudge', '+', function () { set(state.answers[step.id] + spec.step); });
    minus.setAttribute('aria-label', '−' + spec.step);
    plus.setAttribute('aria-label', '+' + spec.step);
    set(value);

    var scale = add(el('div', 'slider-scale'),
      el('span', '', spec.min + ' ' + spec.unit[lang]), el('span', '', spec.max + ' ' + spec.unit[lang]));
    var next = button('btn', t('next'), function () { haptic(); nextStep(); });
    return add(el('div', 'slider'), big,
      add(el('div', 'slider-row'), minus, range, plus), scale,
      add(el('div', 'step-actions'), next));
  }

  function wizardScreen() {
    var step = data.steps[state.step];
    var total = data.steps.length;
    var label = fill(t('step_of'), { i: state.step + 1, n: total });
    var body = add(el('div', 'step'), el('h1', 'step-title', step.title[lang]),
      step.slider ? sliderBlock(step) : optionsBlock(step));
    return add(el('section', 'screen'), topbar(label), progress(state.step + 1, total), body);
  }

  function photoItem(src, label, alt) {
    var item = el('li', 'photo is-empty');
    var caption = el('span', 'photo-label', label);
    var img = el('img');
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', function () {
      item.classList.remove('is-empty');
      caption.hidden = true;
    });
    img.addEventListener('error', function () { img.remove(); });
    img.src = src;
    return add(item, img, caption);
  }

  function externalLink(label, url) {
    var link = el('a', 'btn-outline', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', function (event) {
      if (!inTelegram) return; // в браузере — обычный переход по ссылке
      event.preventDefault();
      tg.openLink(url);
    });
    return link;
  }

  function portfolioScreen() {
    var head = add(el('div', 'section-head'),
      el('h1', 'section-title', t('portfolio_title')), el('p', 'lead', t('portfolio_lead')));
    var projects = el('div', 'projects');
    data.portfolio.forEach(function (project, index) {
      var title = project.title[lang];
      var photos = el('ul', 'photos');
      project.photos.forEach(function (src, n) {
        var label = t('photo') + ' ' + (n + 1);
        add(photos, photoItem(src, label, title + ' · ' + label));
      });
      var number = el('span', 'project-index', (index < 9 ? '0' : '') + (index + 1));
      add(projects, add(el('article', 'project'),
        add(el('div', 'project-head'), el('h2', 'project-title', title), number), photos));
    });
    var actions = add(el('div', 'screen-actions'),
      button('btn', t('to_summary'), function () { haptic(); go('summary'); }));
    if (data.instagram) add(actions, externalLink(t('instagram'), data.instagram));
    return add(el('section', 'screen'), topbar(t('brand')), head, projects, actions);
  }

  function answerText(step) {
    var value = state.answers[step.id];
    if (step.slider) return value + ' ' + step.slider.unit[lang];
    var match = step.options.filter(function (option) { return option.id === value; })[0];
    return match ? match.label[lang] : '';
  }

  function summaryScreen() {
    var head = add(el('div', 'section-head'),
      el('h1', 'section-title', t('summary_title')), el('p', 'lead', t('summary_lead')));
    var list = el('dl', 'summary-list');
    data.steps.forEach(function (step) {
      add(list, add(el('div', 'summary-row'),
        el('dt', '', step.title[lang]), el('dd', '', answerText(step))));
    });
    var screen = add(el('section', 'screen'), topbar(t('brand')), head, list);
    if (!inTelegram) {
      // вне Telegram нативной MainButton нет — показываем её замену и подсказку
      add(screen, add(el('div', 'screen-actions'), button('btn', t('submit'), submit)));
    }
    add(screen, el('p', 'note', t('refs_hint')));
    if (!inTelegram || state.undelivered) add(screen, el('p', 'note', t('outside')));
    return screen;
  }

  function thanksScreen() {
    var title = state.viaLink ? t('confirm_title') : t('thanks_title');
    var text = state.viaLink ? t('confirm_text') : t('thanks_text');
    return add(el('section', 'screen thanks'), el('span', 'brand-mark', 'A'),
      el('h1', 'thanks-title', title), el('p', 'lead', text));
  }

  var SCREENS = {
    welcome: welcomeScreen,
    wizard: wizardScreen,
    portfolio: portfolioScreen,
    summary: summaryScreen,
    thanks: thanksScreen
  };

  function render() {
    if (state.screen === 'summary' && !isComplete()) state.screen = 'wizard';
    root.replaceChildren(SCREENS[state.screen]());
    window.scrollTo(0, 0);
    var heading = root.querySelector('h1'); // фокус на заголовок нового экрана — для клавиатуры и чтения с экрана
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    syncTelegramChrome();
  }

  // ---------- запуск ----------

  function validate(json) {
    var ok = json && Array.isArray(json.steps) && json.steps.length && json.texts &&
      Array.isArray(json.langs) && Array.isArray(json.portfolio);
    if (!ok) throw new Error('steps.json has an unexpected shape');
    return json;
  }

  function start(json) {
    data = validate(json);
    lang = detectLang();
    document.documentElement.lang = lang;
    document.title = t('brand');
    applyTheme();
    if (inTelegram) {
      tg.onEvent('themeChanged', applyTheme);
      tg.MainButton.onClick(submit);
      if (supports('6.1')) tg.BackButton.onClick(back);
      tg.expand();
      tg.ready();
    }
    if (!inTelegram) openPreviewScreen();
    render();
  }

  /** Только для локального превью: ?screen=wizard&step=1 открывает нужный экран с ответами по умолчанию. */
  function openPreviewScreen() {
    var params = new URLSearchParams(window.location.search);
    var screen = params.get('screen');
    if (!SCREENS[screen] || screen === 'welcome') return;
    data.steps.forEach(function (step) {
      state.answers[step.id] = step.slider ? step.slider.default : step.options[0].id;
    });
    state.screen = screen;
    state.step = Math.min(data.steps.length - 1, Math.max(0, Number(params.get('step')) || 0));
  }

  function fail(error) {
    window.console.error(error);
    root.replaceChildren(el('p', 'boot', 'ARUUM STUDIO · ошибка загрузки / yuklashda xatolik'));
    if (inTelegram) tg.ready();
  }

  window.fetch('steps.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('steps.json: HTTP ' + response.status);
      return response.json();
    })
    .then(start)
    .catch(fail);
}());
