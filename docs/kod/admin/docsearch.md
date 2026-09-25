## 环境要求

- 本节仅适用于单独购买该插件的企业用户。免费用户请忽略本环节。

## 插件介绍

在网盘文件管理页面搜索时，勾选**更多 → 文件内容**，默认只能搜索 txt 等纯文本文件的内容。若需要对 PDF、Office 等格式的文件内容进行搜索，需安装本插件。

> **注意**
>
> - 需在插件中心启用插件，且**连接测试正常**后方可使用。
> - 插件工作原理：提取文件文字内容存入数据库，并对数据库建立 `fulltext`（全文）索引。
> - 文件内容提取默认每分钟执行一次，可在后台「服务器管理 → 计划任务」中查看。

## 配置说明

按以下步骤完成配置：

1. 在插件中心安装**全文搜索**插件。
2. 在服务器端安装 Java 运行环境，然后在插件配置页检查连接测试是否正常。

   ```bash
   yum install java-11-openjdk
   ```

3. 连接到 MySQL 数据库，创建全文索引：

   ```sql
   -- 移除旧的索引(不存在报错正常)
   ALTER TABLE `comment` DROP INDEX `content`;
   ALTER TABLE `user_meta` DROP INDEX `value`;
   ALTER TABLE `group_meta` DROP INDEX `value`;
   ALTER TABLE `io_source` DROP INDEX `name`;
   ALTER TABLE `io_source_meta` DROP INDEX `value`;
   ALTER TABLE `io_file_contents` DROP INDEX `content`;

   -- 创建全文索引
   ALTER TABLE `comment` ADD FULLTEXT (`content`);
   ALTER TABLE `user_meta` ADD FULLTEXT (`value`);
   ALTER TABLE `group_meta` ADD FULLTEXT (`value`);
   ALTER TABLE `io_source` ADD FULLTEXT (`name`);
   ALTER TABLE `io_source_meta` ADD FULLTEXT (`value`);
   -- 这步可能非常耗时，和文件数量相关
   ALTER TABLE `io_file_contents` ADD FULLTEXT (`content`) WITH PARSER ngram;
   ```

> **提示**
>
> - ngram 对中文分词较精准，但可能因短词重复率过高导致内存不足报错「FTS query exceeds」。可在 `/etc/my.cnf` 中优化配置：
   ```my.cnf
   ngram_token_size = 4  #ngram 分词器中 N 的大小，默认为2，增大以避免查询过宽
   innodb_ft_result_cache_limit = 4G  #InnoDB 引擎结果缓存大小，默认2G，最大4G
   ```
> - 若使用的是不支持 ngram 的 MariaDB（而非 MySQL），最后一条 SQL 改为：
   ```sql
   ALTER TABLE `io_file_contents` ADD FULLTEXT(`content`);
   ```

- （可选）在站点 `config/setting_user.php` 文件末尾新增配置：
```php
$config['settingSystemDefault']['searchFulltext'] = 1;  // like%% 转为全文索引（默认只有内容搜索会用全文索引，这里把普通查询也改成全文索引方式）
// $config['settingSystemDefault']['searchFulltextForce']  = 1;    // 完整匹配; (否则会对$words进行分词,包含一部分也作为结果;会多出结果)
$config['settingSystemDefault']['searchFulltextInnodb'] = 1;
```

- （可选）若数据库表未使用 InnoDB 引擎，建议修改为 InnoDB：

```sql
alter table comment engine=InnoDB;
alter table comment_meta engine=InnoDB;
alter table comment_praise engine=InnoDB;
alter table `group` engine=InnoDB;
alter table group_meta engine=InnoDB;
alter table io_file engine=InnoDB;
alter table io_file_contents engine=InnoDB;
alter table io_file_meta engine=InnoDB;
alter table io_source engine=InnoDB;
alter table io_source_auth engine=InnoDB;
alter table io_source_event engine=InnoDB;
alter table io_source_history engine=InnoDB;
alter table io_source_meta engine=InnoDB;
alter table io_source_recycle engine=InnoDB;
alter table share engine=InnoDB;
alter table share_report engine=InnoDB;
alter table share_to engine=InnoDB;
alter table system_log engine=InnoDB;
alter table system_option engine=InnoDB;
alter table system_session engine=InnoDB;
alter table `user` engine=InnoDB;
alter table user_fav engine=InnoDB;
alter table user_group engine=InnoDB;
alter table user_meta engine=InnoDB;
alter table user_option engine=InnoDB;
```
