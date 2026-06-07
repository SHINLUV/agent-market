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
  var currentSessionId = null;  // 当前对话 Session ID

  // ==================== Markdown 渲染 ====================
  function renderMarkdown(text) {
    if (!text) return '';
    var html = text;

    // 转义 HTML 防止 XSS
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 表格 —— | col1 | col2 |
    html = html.replace(/((?:^\|.+?\|[ \t]*\n)+)/gm, function(match) {
      var lines = match.trim().split('\n');
      if (lines.length < 2) return match;
      var out = '<table class="md-table"><thead>';
      // 表头
      var headerCells = lines[0].split('|').filter(function(c) { return c.trim(); });
      out += '<tr>' + headerCells.map(function(c) { return '<th>' + c.trim() + '</th>'; }).join('') + '</tr></thead><tbody>';
      // 跳过分隔行（如果有的话）
      var start = 1;
      if (lines[1] && /^[\|\s\-:]+$/.test(lines[1])) start = 2;
      for (var i = start; i < lines.length; i++) {
        var cells = lines[i].split('|').filter(function(c) { return c.trim(); });
        out += '<tr>' + cells.map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
      }
      out += '</tbody></table>';
      return out;
    });

    // 粗体 **text** 或 __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 斜体 *text*
    html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

    // 行内代码 `code`
    html = html.replace(/`([^`\n]+?)`/g, '<code class="md-code">$1</code>');

    // 标题 ### 、 ## 、 #
    html = html.replace(/^#### (.+)$/gm, '<h5 class="md-h5">$1</h5>');
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');

    // 无序列表
    html = html.replace(/^[\-\*] (.+)$/gm, '<li class="md-li">$1</li>');
    html = html.replace(/((?:<li class="md-li">.+<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-li">$1</li>');
    // 合并连续的有序列表项
    html = html.replace(/((?:<li class="md-li">.+<\/li>\n?)+)/g, function(m) {
      // 避免重复包装已经包过的
      if (m.indexOf('<ul') !== -1) return m;
      return '<ol class="md-ol">' + m + '</ol>';
    });

    // 水平线 ---
    html = html.replace(/^\-{3,}$/gm, '<hr class="md-hr">');

    // 段落：双换行转段落
    // 先保护已渲染的 HTML 标签
    var blocks = html.split(/\n\n+/);
    html = blocks.map(function(block) {
      block = block.trim();
      if (!block) return '';
      // 已经是 HTML 标签的块不包裹
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
    // keepSession=true 时不重置 session（从详情弹窗切过来保留对话）
    if (!keepSession || !currentSessionId || currentAgent !== a) {
      currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    currentAgent = a;
    chatTitle.textContent = a.name;
    chatSubtitle.textContent = '全部免费 · ' + a.category;
    chatAvatar.textContent = a.icon || '🤖';

    var msgs = chatBody.querySelectorAll('.chat-msg');
    msgs.forEach(function(m){ m.remove(); });
    chatWelcome.innerHTML = '<p><strong>' + a.name + '</strong></p><p>' + a.desc + '</p><p class="chat-hint">把你要分析的数据粘贴到下面，按回车发送<br><small>支持多轮追问，AI 会记住上下文</small></p>';

    chatWelcome.style.display = 'block';

    chatOverlay.classList.add('active');
    chatInput.value = '';
    chatInput.focus();
  }

  function sendMessage(){
    var msg = chatInput.value.trim();
    if(!msg || !currentAgent) return;

    addMessage('user', msg);
    chatInput.value = '';
    chatWelcome.style.display = 'none';

    addMessage('bot', '<span class="typing">思考中...</span>');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function(){
      var botMsgs = chatBody.querySelectorAll('.chat-msg.bot');
      var lastBot = botMsgs[botMsgs.length - 1];
      if(xhr.status === 200){
        var resp = JSON.parse(xhr.responseText);
        if(lastBot) lastBot.querySelector('.msg-content').innerHTML = renderMarkdown(resp.reply);
      } else {
        try {
          var err = JSON.parse(xhr.responseText);
          if(lastBot) lastBot.querySelector('.msg-content').textContent = '出错了：' + err.error;
        } catch(e){
          if(lastBot) lastBot.querySelector('.msg-content').textContent = '服务器出错了，稍后再试';
        }
      }
    };
    xhr.onerror = function(){
      var botMsgs = chatBody.querySelectorAll('.chat-msg.bot');
      var lastBot = botMsgs[botMsgs.length - 1];
      if(lastBot) lastBot.querySelector('.msg-content').textContent = '网络错误，检查服务器是否在运行';
    };
    xhr.send(JSON.stringify({ agent_id: currentAgent.name, message: msg, session_id: currentSessionId }));
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

  // 新对话按钮
  var chatNewSession = document.getElementById('chatNewSession');
  if(chatNewSession) {
    chatNewSession.addEventListener('click', function(){
      if(!currentAgent) return;
      // 重置 session
      currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      // 清空聊天记录
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
