(function(){
  var grid = document.getElementById('agentGrid');
  var empty = document.getElementById('emptyState');
  var tagsEl = document.getElementById('filterTags');
  var searchInput = document.getElementById('searchInput');
  var modalOverlay = document.getElementById('modalOverlay');
  var countEl = document.getElementById('agentCount');

  // Chat panel
  var chatOverlay = document.getElementById('chatOverlay');
  var chatBody = document.getElementById('chatBody');
  var chatInput = document.getElementById('chatInput');
  var chatSend = document.getElementById('chatSend');
  var chatTitle = document.getElementById('chatTitle');
  var chatSubtitle = document.getElementById('chatSubtitle');
  var chatAvatar = document.getElementById('chatAvatar');
  var chatWelcome = document.getElementById('chatWelcome');
  var chatClose = document.getElementById('chatClose');

  var activeCat = 'all';
  var searchQuery = '';
  var currentAgent = null;
  var currentSessionId = null;

  // Agnes AI 配置（浏览器直调）
  var AGNES_KEY = 'sk-j32i7VBnFAxhzssfDhdYvsiRPP4eABkw1OtfffgoTKErH5oB';
  var AGNES_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';

  // ==================== 埋点统计 ====================
  function trackClick(agentName, action) {
    var key = 'tf_stats';
    var data = {};
    try { data = JSON.parse(localStorage.getItem(key)) || {}; } catch(e) {}
    if (!data[agentName]) data[agentName] = { try: 0, detail: 0, total: 0 };
    data[agentName][action] = (data[agentName][action] || 0) + 1;
    data[agentName].total = (data[agentName].total || 0) + 1;
    localStorage.setItem(key, JSON.stringify(data));
  }

  function getHotAgents(n) {
    var key = 'tf_stats';
    var data = {};
    try { data = JSON.parse(localStorage.getItem(key)) || {}; } catch(e) {}
    var sorted = Object.entries(data).sort(function(a, b) { return b[1].total - a[1].total; });
    return sorted.slice(0, n || 3).map(function(e) { return e[0]; });
  }

  // ==================== 示例展示 ====================
  function showDemo(a) {
    var msgs = chatBody.querySelectorAll('.chat-msg');
    msgs.forEach(function(m){ m.remove(); });
    chatWelcome.style.display = 'none';

    if (a.exampleInput) {
      addMessage('user', a.exampleInput);
    }
    if (a.exampleOutput) {
      addMessage('bot', renderMarkdown(a.exampleOutput));
    }
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // ==================== Markdown 渲染 ====================
  function renderMarkdown(text) {
    if (!text) return '';
    var html = text;

    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    html = html.replace(/((?:^\|.+?\|[ \t]*\n)+)/gm, function(match) {
      var lines = match.trim().split('\n');
      if (lines.length < 2) return match;
      var out = '<table class="md-table"><thead>';
      var headerCells = lines[0].split('|').filter(function(c) { return c.trim(); });
      out += '<tr>' + headerCells.map(function(c) { return '<th>' + c.trim() + '</th>'; }).join('') + '</tr></thead><tbody>';
      var start = 1;
      if (lines[1] && /^[\|\s\-:]+$/.test(lines[1])) start = 2;
      for (var i = start; i < lines.length; i++) {
        var cells = lines[i].split('|').filter(function(c) { return c.trim(); });
        out += '<tr>' + cells.map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
      }
      out += '</tbody></table>';
      return out;
    });

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`\n]+?)`/g, '<code class="md-code">$1</code>');

    html = html.replace(/^#### (.+)$/gm, '<h5 class="md-h5">$1</h5>');
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');

    html = html.replace(/^[\-\*] (.+)$/gm, '<li class="md-li">$1</li>');
    html = html.replace(/((?:<li class="md-li">.+<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

    html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-li">$1</li>');
    html = html.replace(/((?:<li class="md-li">.+<\/li>\n?)+)/g, function(m) {
      if (m.indexOf('<ul') !== -1) return m;
      return '<ol class="md-ol">' + m + '</ol>';
    });

    html = html.replace(/^\-{3,}$/gm, '<hr class="md-hr">');

    var blocks = html.split(/\n\n+/);
    html = blocks.map(function(block) {
      block = block.trim();
      if (!block) return '';
      if (block.indexOf('<table') === 0 || block.indexOf('<ul') === 0 ||
          block.indexOf('<ol') === 0 || block.indexOf('<h') === 0 ||
          block.indexOf('<hr') === 0) {
        return block;
      }
      return '<p class="md-p">' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    return html;
  }

  // Build filter tags
  var cats = {};
  AGENTS.forEach(function(a){
    if(!cats[a.category]) cats[a.category] = 0;
    cats[a.category]++;
  });
  Object.keys(cats).forEach(function(cat){
    var btn = document.createElement('button');
    btn.className = 'tag';
    btn.dataset.category = cat;
    btn.textContent = cat + ' ' + cats[cat];
    btn.addEventListener('click', function(){
      activeCat = cat;
      tagsEl.querySelectorAll('.tag').forEach(function(t){ t.classList.remove('tag-active'); });
      btn.classList.add('tag-active');
      render();
    });
    tagsEl.appendChild(btn);
  });

  function getFiltered(){
    return AGENTS.filter(function(a){
      var matchCat = activeCat === 'all' || a.category === activeCat;
      var q = searchQuery.toLowerCase();
      var matchSearch = !q ||
        a.name.toLowerCase().indexOf(q) !== -1 ||
        a.desc.toLowerCase().indexOf(q) !== -1 ||
        a.tags.some(function(t){ return t.toLowerCase().indexOf(q) !== -1; }) ||
        a.category.toLowerCase().indexOf(q) !== -1;
      return matchCat && matchSearch;
    });
  }

  function render(){
    var list = getFiltered();
    grid.innerHTML = '';
    if(list.length === 0){
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    // 热门 Agent（全部+无搜索时显示）
    if (activeCat === 'all' && !searchQuery) {
      var hotNames = getHotAgents(3);
      if (hotNames.length >= 2) {
        var hotAgents = hotNames.map(function(n) { return AGENTS.find(function(a) { return a.name === n; }); }).filter(Boolean);
        if (hotAgents.length >= 2) {
          var hotSection = document.createElement('div');
          hotSection.className = 'hot-section';
          hotSection.innerHTML = '<div class="hot-label">🔥 热门</div><div class="hot-row"></div>';
          var hotRow = hotSection.querySelector('.hot-row');
          hotAgents.forEach(function(a) {
            var chip = document.createElement('span');
            chip.className = 'hot-chip';
            chip.textContent = a.icon + ' ' + a.name;
            chip.addEventListener('click', function() { openChat(a); });
            hotRow.appendChild(chip);
          });
          grid.appendChild(hotSection);
        }
      }
    }

    list.forEach(function(a){
      var card = document.createElement('div');
      card.className = 'card';
      var icon = a.icon || '🤖';
      var catMap = {'客服':'cat-customer','运营':'cat-ops','转化':'cat-convert','分析':'cat-analysis'};
      var catClass = catMap[a.category] || 'cat-ops';
      card.innerHTML =
        '<div class="card-body">' +
          '<div class="card-cat ' + catClass + '">' + a.category + '</div>' +
          '<div class="card-top">' +
            '<div class="card-icon">' + icon + '</div>' +
            '<h3>' + a.name + '</h3>' +
          '</div>' +
          '<p>' + a.desc + '</p>' +
          '<div class="card-tags">' + a.tags.map(function(t){ return '<span class="card-tag">' + t + '</span>'; }).join('') + '</div>' +
        '</div>' +
        '<div class="card-footer">' +
          '<span class="btn-sm btn-detail">查看详情</span>' +
          '<span class="btn-sm btn-try">在线试用 &rarr;</span>' +
        '</div>';

      card.querySelector('.btn-detail').addEventListener('click', function(e){
        e.stopPropagation();
        showModal(a);
      });

      card.querySelector('.btn-try').addEventListener('click', function(e){
        e.stopPropagation();
        openChat(a);
      });

      grid.appendChild(card);
    });
  }

  // ==================== Modal ====================
  function showModal(a){
    trackClick(a.name, 'detail');
    document.getElementById('modalTitle').textContent = a.name;
    document.getElementById('modalTags').innerHTML = a.tags.map(function(t){ return '<span>' + t + '</span>'; }).join('');
    document.getElementById('modalDesc').textContent = a.desc;
    document.getElementById('modalPrompt').textContent = a.prompt;
    var guideDiv = document.getElementById('modalGuide');
    guideDiv.innerHTML = '<ol class="guide-list">' + a.guide.map(function(g){ return '<li>' + g + '</li>'; }).join('') + '</ol>';
    var dl = document.getElementById('modalDownload');
    dl.href = 'agents/' + a.zipName;
    modalOverlay.classList.add('active');

    document.getElementById('modalTry').onclick = function(){
      modalOverlay.classList.remove('active');
      openChat(a);
    };
  }

  document.getElementById('modalClose').addEventListener('click', function(){ modalOverlay.classList.remove('active'); });
  modalOverlay.addEventListener('click', function(e){ if(e.target === modalOverlay) modalOverlay.classList.remove('active'); });

  // ==================== Chat ====================
  function openChat(a, keepSession){
    if (!keepSession || !currentSessionId || currentAgent !== a) {
      currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    currentAgent = a;
    trackClick(a.name, 'try');
    chatTitle.textContent = a.name;
    chatSubtitle.textContent = '全部免费 · ' + a.category;
    chatAvatar.textContent = a.icon || '🤖';

    var msgs = chatBody.querySelectorAll('.chat-msg');
    msgs.forEach(function(m){ m.remove(); });
    var exampleBtn = (a.exampleInput && a.exampleOutput)
      ? '<button class="btn-example" id="btnExample">✨ 查看示例：输入→AI回复</button>'
      : '';
    chatWelcome.innerHTML = '<p><strong>' + a.name + '</strong></p><p>' + a.desc + '</p>' + exampleBtn + '<p class="chat-hint">把你要分析的数据粘贴到下面，按回车发送<br><small>支持多轮追问，AI 会记住上下文</small></p>';

    chatWelcome.style.display = 'block';

    chatOverlay.classList.add('active');
    chatInput.value = '';
    chatInput.focus();

    // 绑定示例按钮
    var btnEx = document.getElementById('btnExample');
    if (btnEx) {
      btnEx.addEventListener('click', function() { showDemo(a); });
    }
  }

  function sendMessage(){
    var msg = chatInput.value.trim();
    if(!msg || !currentAgent) return;

    addMessage('user', msg);
    chatInput.value = '';
    chatWelcome.style.display = 'none';

    addMessage('bot', '<span class="typing">思考中...</span>');

    // 直接从浏览器调用 Agnes AI（CORS 支持）
    var systemPrompt = currentAgent.prompt || '';
    var model = currentAgent.model === 'pro' ? 'agnes-2.0' : 'agnes-2.0-flash';

    fetch(AGNES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AGNES_KEY
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: msg }
        ]
      })
    })
    .then(function(resp){
      if(!resp.ok) return resp.json().then(function(e){ throw new Error(e.error || ('HTTP ' + resp.status)); });
      return resp.json();
    })
    .then(function(data){
      var botMsgs = chatBody.querySelectorAll('.chat-msg.bot');
      var lastBot = botMsgs[botMsgs.length - 1];
      if(lastBot) lastBot.querySelector('.msg-content').innerHTML = renderMarkdown(data.choices[0].message.content);
    })
    .catch(function(err){
      var botMsgs = chatBody.querySelectorAll('.chat-msg.bot');
      var lastBot = botMsgs[botMsgs.length - 1];
      if(lastBot) lastBot.querySelector('.msg-content').textContent = '出错了：' + (err.message || '网络错误');
    });
  }

  function addMessage(type, content){
    var div = document.createElement('div');
    div.className = 'chat-msg ' + type;
    div.innerHTML = '<div class="msg-bubble"><div class="msg-content">' + content + '</div></div>';
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
    return div;
  }

  chatSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  chatClose.addEventListener('click', function(){ chatOverlay.classList.remove('active'); });
  chatOverlay.addEventListener('click', function(e){ if(e.target === chatOverlay) chatOverlay.classList.remove('active'); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ chatOverlay.classList.remove('active'); modalOverlay.classList.remove('active'); }});

  var chatNewSession = document.getElementById('chatNewSession');
  if(chatNewSession) {
    chatNewSession.addEventListener('click', function(){
      if(!currentAgent) return;
      currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var msgs = chatBody.querySelectorAll('.chat-msg');
      msgs.forEach(function(m){ m.remove(); });
      chatWelcome.style.display = 'block';
      chatInput.value = '';
      chatInput.focus();
      chatSubtitle.textContent = '全部免费 · ' + currentAgent.category;
    });
  }

  // ==================== Search ====================
  searchInput.addEventListener('input', function(e){
    searchQuery = e.target.value;
    render();
  });

  if(countEl) countEl.textContent = AGENTS.length;
  render();
})();
