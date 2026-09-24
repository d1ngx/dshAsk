kodReady.push(function(){
	var iconFile = '{{pluginHost}}static/images/icon.svg';
	var api = '{{pluginApi}}';
	var openWith = '{{config.openWith}}' || 'dialog';
	var menuTitle = "{{LNG['dshAsk.menu']}}";
	var menuCurrent = "{{LNG['dshAsk.menuCurrent']}}";

	Events.bind('main.menu.loadBefore', function(listData){
		if ('{{config.menuAdd}}' != '1') return;
		listData['{{package.id}}'] = {
			name: "{{package.menu}}",
			url: api,
			target: '_blank',
			subMenu: '{{config.menuSubMenu}}',
			menuAdd: '{{config.menuAdd}}',
			icon: iconFile,
			width: '86%',
			height: '82%'
		};
	});

	Events.bind('explorer.lightApp.load', function(listData){
		listData['{{package.id}}'] = {
			name: "{{package.menu}}",
			desc: "{{LNG['dshAsk.lightApp.desc']}}",
			category: 'tools',
			appUrl: api,
			openWith: '_blank',
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
		// DSH refuses the page unless its own tab completed the launch-token
		// exchange. A KodBox dialog iframe cannot keep that cookie.
		window.open(link, '_blank', 'noopener');
	}
});
