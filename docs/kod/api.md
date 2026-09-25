# 网盘设置可用接口

只列出问答允许调用的接口。写入类必须用户确认后再把 confirm 设为 true。登录、改密码、上传下载不在此列。路径参数使用 {source:数字}/，不要在后面接文件名。

## 1. 获取文件列表
- 路由：`explorer/list/path`
- 类型：查询
- 参数：
```
path: '{source:593}/'// 目录地址
page: 1             // 可选；非系统默认存储目录时，该参数无效
pageNum: 3          // 可选；非系统默认存储目录时，该参数无效
----
path: '{search}/' + param.join('@');
var param = [
'parentPath',   // 选择全部文件夹时为空
'words',        // 搜索关键字
'sizeFrom',     // 大小，单位B
'sizeTo',
'timeFrom',     // 时间，格式：2020/02/21
'timeTo',
'fileType',     // 文件类型，根据文件列表获取，参数：path={block:fileType}
'createUser'    // userID
]
```

## 2. 获取文件属性
- 路由：`explorer/index/pathInfo`
- 类型：查询
- 参数：
```
dataArr: [{"path":"{source:705}/","name":"部署步骤-回复.docx","type":"file"}]    // json格式
```

## 3. 创建文件夹
- 路由：`explorer/index/mkdir`
- 类型：写入，需确认
- 参数：
```
path: {source:714}/列表目录     // {source:714}为父目录路径
```

## 4. 文件（夹）重命名
- 路由：`explorer/index/pathRename`
- 类型：写入，需确认
- 参数：
```
path: {source:719}/     // 路径
newName: 列表目录_new    // 新的名称
```

## 5. 批量移动文件（夹）
- 路由：`explorer/index/pathCuteTo`
- 类型：写入，需确认
- 参数：
```
dataArr: [ // 待移动文件（夹）列表，json格式
    {
        "path":"{source:821}/", // 文件路径
        "name":"新建文件夹",    // 文件名称
        "type":"folder"         // 文件类型：folder-文件夹;file-文件
    },
    {"path":"{source:923}/","name":"IMG_20190614_102135.jpg","type":"file"},
    ...
]
path: {source:27}/  // 目标文件夹路径
```

## 6. 批量复制文件（夹）
- 路由：`explorer/index/pathCopyTo`
- 类型：写入，需确认
- 参数：
```
dataArr: [ // 待复制文件（夹）列表，json格式
    {"path":"{source:821}/","name":"新建文件夹","type":"folder"},
    {"path":"{source:923}/","name":"IMG_20190614_102135.jpg","type":"file"},
    ...
]
path: {source:27}/  // 目标文件夹路径
```

## 7. 添加到收藏夹
- 路由：`explorer/fav/add`
- 类型：写入，需确认
- 参数：
```
path: {source:1025}/    // 路径
name: nginx.conf        // 收藏名称
type: file              // 类型：file、folder
```

## 8. 取消某个收藏
- 路由：`explorer/fav/del`
- 类型：写入，需确认
- 参数：
```
name: nginx.conf    // 收藏名称
```

## 9. 批量删除文件（夹）
- 路由：`explorer/index/pathDelete`
- 类型：写入，需确认
- 参数：
```
dataArr: [{"path":"{source:821}/","name":"新建文件夹","type":"folder"},{"path":"{source:923}/","name":"IMG_20190614_102135.jpg","type":"file"},{"path":"{source:1025}/","name":"nginx.conf","type":"file"}] // 待删除文件（夹）列表，json格式
shiftDelete: 0  // 可选；shiftDelete=1表示彻底删除，默认为0
```

## 11. 新建文件
- 路由：`explorer/index/mkfile`
- 类型：写入，需确认
- 参数：
```
path: {source:719}/新建文件.docx // {source:714}为父目录路径
```

## 19. 文档权限设置
- 路由：`explorer/index/setAuth`
- 类型：写入，需确认
- 参数：
```
path: {source: 714}/                                // 目录地址
auth: [
	{												// 设置者权限
		"targetType":1,								// 用户:1；部门:2
		"targetID":"1",								// userID，targetType=2时为groupID
		"authID":1									// 文档权限id
	},
	{"targetType":1,"targetID":0,"authID":"2"},		// 该部门下通用权限(targetID=0)；保持原有权限(继承上级)时，不含该项
	{"targetType":1,"targetID":"9","authID":"1"},	// 指定用户权限
	{"targetType":2,"targetID":"63","authID":"6"}	// 指定部门权限
]
```

## 19.2 文档权限列表获取
- 路由：`admin/auth/get`
- 类型：查询

## 2. 根据文件获取分享信息
- 路由：`explorer/userShare/get`
- 类型：查询
- 参数：
```
**返回结果**：
```

## 3. 添加分享
- 路由：`explorer/userShare/add`
- 类型：写入，需确认
- 参数：
```
**返回结果**：
```

## 4. 编辑分享
- 路由：`explorer/userShare/edit`
- 类型：写入，需确认
- 参数：
```
shareID: 1
isLink: 0           // 是否为外链分享
isShareTo: 1        // 是否为内部分享
title: 00 (1).jpg   // 分享标题
authTo: [{          // json格式
    "targetType":1, // 分享对象：1:用户；2:部门
    "targetID":"9", // 分享对象ID
    "authID":"5"    // 文档权限ID
}]
isLink: 1           // 是否为外链分享
isShareTo: 0        // 是否为内部分享
password:           // 访问密码，随机生成方法见返回结果备注
options: {          // json格式
    "onlyLogin":"1"         // 可选；仅登录用户可用
    "notDownload":1,        // 可选；禁止下载
    "downloadNumber":"100"  // 可选；下载次数限制；与禁止下载不能同时选择

```

## 5. 取消分享
- 路由：`explorer/userShare/del`
- 类型：写入，需确认
- 参数：
```
dataArr: ["3"]  // 数组[分享id]，需转为json格式，
```

## 1. 部门列表
- 路由：`admin/group/get`
- 类型：查询
- 参数：
```
parentID: 1     // 上级部门id，不填则获取根部门
```

## 1.1（根据id）获取部门（列表）
- 路由：`admin/group/getByID`
- 类型：查询
- 参数：
```
id: 2   // 部门id，可用','拼接为字符串请求多个：13,15
```

## 1.2 搜索部门列表
- 路由：`admin/group/search`
- 类型：查询
- 参数：
```
words: 销售部       // 关键字：groupID、name
```

## 2.创建部门
- 路由：`admin/group/add`
- 类型：写入，需确认
- 参数：
```
name: 人事部     // 名称
sizeMax: 200    // 空间大小限制（GB），0表示无限制
parentID: 1     // 上级部门id
```

## 3.编辑部门
- 路由：`admin/group/edit`
- 类型：写入，需确认
- 参数：
```
groupID: 6      // 部门id
name: 行政部     // 部门名称
sizeMax: 0      // 部门空间大小
parentID: 3     // 可选；上级部门id，不填则获取根部门
```

## 4.删除部门
- 路由：`admin/group/remove`
- 类型：写入，需确认
- 参数：
```
groupID: 6      // 部门id
```

## 1.用户列表
- 路由：`admin/member/get`
- 类型：查询
- 参数：
```
groupID: 43     // 所属部门id
page: 1         // 可选；第n页
pageNum: 10     // 可选；每页数量，默认50
```

## 1.1（根据id）获取用户（列表）
- 路由：`admin/member/getByID`
- 类型：查询
- 参数：
```
id: 4   // 用户id，可用','拼接为字符串请求多个：4,5,6
```

## 1.2 搜索用户列表
- 路由：`admin/member/search`
- 类型：查询
- 参数：
```
words: 花满楼       // 关键字：userID、name、nickName、email、phone
```

## 2.新增用户
- 路由：`admin/member/add`
- 类型：写入，需确认
- 参数：
```
name: huamanlou                 // 账号名称
password: 123456                // 密码
roleID: 2                       // 角色id
groupInfo: {"1":"2","2":"6"}    // 所属部门：{部门id: 对应权限id}
sizeMax: 2                      // 用户空间大小限制
----
nickName: 花满楼                 // 可选；昵称
email:                          // 可选；邮箱
phone:                          // 可选；手机号
avatar:                         // 可选；头像
sex: 0                          // 可选；性别：男：1；女：2；未知：0
```

## 3.编辑用户
- 路由：`admin/member/edit`
- 类型：写入，需确认
- 参数：
```
userID: 4                       // 用户id
name: huamanlou                 // 账号名称
roleID: 3                       // 角色id
sizeMax: 5                      // 空间大小
groupInfo: {"1":"2","2":"6","43":"1"}   // 所属部门
----
nickName: 花满楼2                // 可选
email:                          // 可选；邮箱
phone:                          // 可选；手机号
avatar:                         // 可选；头像
sex: 0                          // 可选；性别：男：1；女：2；未知：0
status: 1                       // 可选；状态：启用：1；禁用：0
password: 111111      
```

## 3.1 添加到部门
- 路由：`admin/member/addGroup`
- 类型：写入，需确认
- 参数：
```
userID: 4       // 用户id
groupID: 4      // 部门id
authID: 2       // 部门对应权限id
```

## 3.2 从部门删除
- 路由：`admin/member/removeGroup`
- 类型：写入，需确认
- 参数：
```
userID: 4       // 用户id
groupID: 4      // 部门id
```

## 3.3 启用/禁用
- 路由：`admin/member/status`
- 类型：写入，需确认
- 参数：
```
userID: 4       // 用户id
status: 0       // 状态：启用：1；禁用：0
```

## 4.3 登录后获取配置信息
- 路由：`user/view/options`
- 类型：查询

## 5.删除用户
- 路由：`admin/member/remove`
- 类型：写入，需确认
- 参数：
```
userID: 6      // 用户id
```

## 1.角色列表
- 路由：`admin/role/get`
- 类型：查询

## 2.新增角色
- 路由：`admin/role/add`
- 类型：写入，需确认
- 参数：
```
name: '部门经理'        // 角色名称
display: 1              // 是否显示（启用）：1；0
auth: explorer.share,explorer.zip,admin.index.dashboard,admin.member.list,admin.member.userEdit,admin.auth.list,admin.auth.edit    // 角色权限，多选以英文','分隔
```

## 3.编辑角色
- 路由：`admin/role/edit`
- 类型：写入，需确认
- 参数：
```
id: 5                   // 角色id
name: '部门经理'         // 角色名称
display: 1              // 是否显示（启用）：1；0
auth: explorer.share,explorer.zip,admin.index.dashboard,admin.member.list,admin.member.userEdit,admin.auth.list,admin.auth.edit
```

## 4.删除角色
- 路由：`admin/role/remove`
- 类型：写入，需确认
- 参数：
```
**返回结果**：
```

## 2.新增权限
- 路由：`admin/auth/add`
- 类型：写入，需确认
- 参数：
```
name: '预览权限'        // 权限名称
display: 1              // 是否显示（启用）：1；0
auth: 3                 // 文档权限；多选求和，如3表示列表查看(1)和预览权限(2)
```

## 3.编辑权限
- 路由：`admin/auth/edit`
- 类型：写入，需确认
- 参数：
```
id: 5                   // 权限id
name: '编辑权限'        // 权限名称
display: 1              // 是否显示（启用）：1；0
auth: 51                // 文档权限
```

## 4.删除权限
- 路由：`admin/auth/remove`
- 类型：写入，需确认
- 参数：
```
**返回结果**：
```

## 未从原文抽出参数的路由
无
