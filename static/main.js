kodReady.push(function(){
	var iconFile = '{{pluginHost}}static/images/icon.svg';
	var api = '{{pluginApi}}';
	var openWith = '{{config.openWith}}' || 'dialog';
	var menuTitle = "{{LNG['dshAsk.menu']}}";
	var menuCurrent = "{{LNG['dshAsk.menuCurrent']}}";

	openPreviewFromUrl();
	restoreEmbed();

	function openPreviewFromUrl(){
		var query = new URLSearchParams(window.location.search);
		var path = query.get('dshPreview');
		if (!path || !/^\{source:\d+\}\//.test(path)) return;
		var name = query.get('dshName') || '';
		var ext = (name.split('.').pop() || '').toLowerCase();
		query.delete('dshPreview');
		query.delete('dshName');
		var rest = query.toString();
		window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
		var tries = 0;
		(function open(){
			if (window.kodApp && typeof window.kodApp.open === 'function' && _.get(window, 'Router')) {
				return window.kodApp.open(path, ext, name);
			}
			if (tries++ < 60) setTimeout(open, 250);
		})();
	}

	Events.bind('main.menu.loadBefore', function(listData){
		if ('{{config.menuAdd}}' != '1') return;
		listData['{{package.id}}'] = {
			name: "{{package.menu}}",
			url: api,
			target: openWith === '_blank' ? '_blank' : 'dialog',
			subMenu: '{{config.menuSubMenu}}',
			menuAdd: '{{config.menuAdd}}',
			icon: iconFile,
			width: '86%',
			height: '82%'
		};
	});
	// KodBox opens sidebar entries from link-href before our callback. Catch the click first.
	document.addEventListener('click', function(event){
		var node = event.target && event.target.closest ? event.target.closest('[link-href]') : null;
		if (!node) return;
		var href = node.getAttribute('link-href') || '';
		if (href.indexOf('dshAsk') === -1) return;
		event.preventDefault();
		event.stopPropagation();
		openAsk([], currentPath(window.kodApp && window.kodApp.explorer));
	}, true);

	Events.bind('explorer.lightApp.load', function(listData){
		listData['{{package.id}}'] = {
			name: "{{package.menu}}",
			desc: "{{LNG['dshAsk.lightApp.desc']}}",
			category: 'tools',
			appUrl: api,
			openWith: openWith === '_blank' ? '_blank' : 'dialog',
			icon: iconFile,
			width: '86%',
			height: '82%'
		};
	});

	Events.bind('explorer.path.list.before', function(thePath, explorer){
		if (!explorer || explorer._dshAskMenu) return;
		explorer._dshAskMenu = true;
		explorer.listenTo(explorer.rightMenu, {
			'rightMenu.beforeShow': function(menu, theView){
				menuShow(menu, theView, explorer);
			}
		});
	});

	function menuShow(menu, theView, explorer){
		if (!menu || !menu.$menu) return;
		var isBody = menu.$menu.hasClass('menu-path-body');
		var files = collectFiles(menu, theView, explorer, isBody);
		if (!files.length && !isBody) return;
		if (menu.$menu.find('.dsh-ask-item').length) {
			menu._dshAskFiles = files;
			menu._dshAskCurrent = currentPath(explorer);
			return;
		}
		var item = {
			name: isBody ? menuCurrent : menuTitle,
			icon: iconFile,
			className: 'dsh-ask-item',
			callback: function(){
				openAsk(menu._dshAskFiles || files, menu._dshAskCurrent || currentPath(explorer));
			}
		};
		var addMap = {'dsh-ask': item, 'stp-dsh-ask': '---'};
		if (menu.$menu.find('.copy').length) {
			$.contextMenu.menuAdd(addMap, menu, '', '.copy');
		} else {
			$.contextMenu.menuAdd(addMap, menu, '', '');
		}
		menu._dshAskFiles = files;
		menu._dshAskCurrent = currentPath(explorer);
	}

	function currentPath(explorer){
		return _.get(explorer, 'path.currentPath')
			|| _.get(explorer, 'currentPath')
			|| '';
	}

	function collectFiles(menu, theView, explorer, isBody){
		var files = [];
		if (isBody) {
			var path = currentPath(explorer);
			if (path) {
				files.push({
					path: path,
					name: _.get(explorer, 'path.current.name') || '',
					type: 'folder',
					pathDisplay: _.get(explorer, 'path.current.pathDisplay') || '',
					sourceID: _.get(explorer, 'path.current.sourceID') || '',
					targetType: _.get(explorer, 'path.current.targetType') || ''
				});
			}
			return files;
		}
		var selected = _.get(explorer, 'select.fileLight.listSelect') || [];
		if (selected && selected.length) {
			_.each(selected, function(item){
				pushFile(files, item);
			});
		}
		if (!files.length && theView && typeof theView.targetData === 'function') {
			pushFile(files, theView.targetData(menu));
		}
		return files;
	}

	function pushFile(files, item){
		if (!item || !item.path) return;
		if (item.isDelete == '1' || item.isDelete === 1) return;
		if (item.targetType === 'system') return;
		if (String(item.path).indexOf('{shareItemLink:') === 0) return;
		files.push({
			path: item.path,
			name: item.name || '',
			type: item.type || (item.isFolder == '1' || item.isFolder === 1 ? 'folder' : 'file'),
			pathDisplay: item.pathDisplay || '',
			sourceID: item.sourceID || '',
			targetType: item.targetType || ''
		});
	}

	function openAsk(files, current){
		$.ajax({
			url: api + 'openAsk',
			type: 'POST',
			dataType: 'json',
			data: {
				files: JSON.stringify(files || []),
				currentPath: current || ''
			},
			success: function(res){
				if (!res || !res.code || !res.data || !res.data.link) {
					return Tips.tips(res && res.data ? res.data : LNG['explorer.error'], 'warning');
				}
				openDsh(res.data.link);
			},
			error: function(){
				Tips.tips(LNG['explorer.error'], 'warning');
			}
		});
	}

	function openDsh(link){
		var mode = openWith || 'dialog';
		if (mode === '_blank') {
			window.open(link, '_blank', 'noopener');
			return;
		}
		if (mode === 'embed') {
			openEmbed(link);
			return;
		}
		openDialog(link);
	}

	function openDialog(link){
		var height = Math.max(480, $(window).height() - 80);
		$.dialog({
			title: menuTitle,
			width: '86%',
			height: '86%',
			padding: 0,
			resize: true,
			content: '<iframe src="' + _.escape(link) + '" style="width:100%;height:' + height + 'px;border:0;display:block" allow="clipboard-read; clipboard-write"></iframe>'
		});
	}

	function restoreEmbed(){
		var link = '';
		try { link = sessionStorage.getItem('dshAskEmbed') || ''; } catch (e) { link = ''; }
		if (!link || !window.Router || typeof Router.mapIframe !== 'function') return;
		Router.mapIframe({page: 'dshAsk', title: menuTitle, url: link, ignoreLogin: false});
		var hash = (window.location.hash || '').replace(/^#/, '');
		if (hash === 'dshAsk' || hash.indexOf('dshAsk&') === 0) Router.go('dshAsk');
	}

	function openEmbed(link){
		try { sessionStorage.setItem('dshAskEmbed', link); } catch (e) {}
		if (window.Router && typeof Router.mapIframe === 'function' && typeof Router.go === 'function') {
			Router.mapIframe({page: 'dshAsk', title: menuTitle, url: link, ignoreLogin: false});
			Router.go('dshAsk');
			return;
		}
		var host = document.querySelector('.app-main') || document.querySelector('.bodymain') || document.body;
		var box = document.getElementById('dsh-ask-embed');
		if (!box) {
			box = document.createElement('div');
			box.id = 'dsh-ask-embed';
			box.style.cssText = 'position:absolute;inset:0;z-index:200;background:#fff;display:flex;flex-direction:column';
			if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
			host.appendChild(box);
		}
		box.innerHTML = '';
		var bar = document.createElement('div');
		bar.style.cssText = 'height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid rgba(0,0,0,.08);font-size:13px';
		bar.textContent = menuTitle;
		var close = document.createElement('button');
		close.type = 'button';
		close.textContent = '关闭';
		close.style.cssText = 'border:0;background:transparent;cursor:pointer';
		close.onclick = function(){ box.remove(); };
		bar.appendChild(close);
		var frame = document.createElement('iframe');
		frame.src = link;
		frame.style.cssText = 'flex:1;width:100%;border:0';
		frame.setAttribute('allow', 'clipboard-read; clipboard-write');
		box.appendChild(bar);
		box.appendChild(frame);
	}
});
