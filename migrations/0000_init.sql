CREATE TABLE `abuse_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ip_hash` text,
	`visitor_id` text,
	`detail` text,
	`country` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `abuse_created_idx` ON `abuse_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`project_id` integer,
	`github_asset_id` integer,
	`release_tag` text NOT NULL,
	`release_name` text,
	`file_name` text NOT NULL,
	`label` text,
	`label_ar` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`content_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`download_url` text NOT NULL,
	`checksum_sha256` text,
	`release_notes` text,
	`release_published_at` text,
	`is_prerelease` integer DEFAULT false NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_assets_unique_idx` ON `app_assets` (`app_id`,`release_tag`,`file_name`);--> statement-breakpoint
CREATE INDEX `app_assets_app_idx` ON `app_assets` (`app_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `app_assets_project_idx` ON `app_assets` (`project_id`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`tagline` text,
	`tagline_ar` text,
	`body_markdown` text,
	`body_markdown_ar` text,
	`platform` text DEFAULT 'windows' NOT NULL,
	`requirements` text,
	`requirements_ar` text,
	`install_notes` text,
	`install_notes_ar` text,
	`repo_full_name` text,
	`current_version` text,
	`pricing_mode` text DEFAULT 'free' NOT NULL,
	`price_label` text,
	`price_label_ar` text,
	`pricing_details` text,
	`pricing_details_ar` text,
	`payment_url` text,
	`payment_method` text,
	`license_note` text,
	`license_note_ar` text,
	`icon_url` text,
	`screenshots` text DEFAULT '[]' NOT NULL,
	`features` text DEFAULT '[]' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`auto_created` integer DEFAULT false NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`downloads_count` integer DEFAULT 0 NOT NULL,
	`stars_cached` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_idx` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `apps_visibility_idx` ON `apps` (`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`meta` text,
	`ip_hash` text,
	`country` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'certificate' NOT NULL,
	`title` text NOT NULL,
	`title_ar` text,
	`issuer` text,
	`issuer_ar` text,
	`issued_year` text,
	`note` text,
	`note_ar` text,
	`url` text,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credentials_visible_idx` ON `credentials` (`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer,
	`asset_id` integer,
	`project_id` integer,
	`slug` text NOT NULL,
	`file_name` text,
	`release_tag` text,
	`visitor_id` text,
	`country` text,
	`city` text,
	`region` text,
	`timezone` text,
	`device` text,
	`browser` text,
	`os` text,
	`referrer` text,
	`referrer_host` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`ip_hash` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `downloads_created_idx` ON `downloads` (`created_at`);--> statement-breakpoint
CREATE INDEX `downloads_app_idx` ON `downloads` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `experience` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`role_ar` text,
	`organization` text,
	`organization_ar` text,
	`location` text,
	`location_ar` text,
	`employment_type` text,
	`start_date` text,
	`end_date` text,
	`is_current` integer DEFAULT false NOT NULL,
	`summary` text,
	`summary_ar` text,
	`highlights` text DEFAULT '[]' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experience_visible_idx` ON `experience` (`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`owner_id` integer,
	`owner_key` text NOT NULL,
	`path` text NOT NULL,
	`kv_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`is_entry` integer DEFAULT false NOT NULL,
	`title` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_unique_idx` ON `files` (`scope`,`owner_key`,`path`);--> statement-breakpoint
CREATE INDEX `files_owner_idx` ON `files` (`scope`,`owner_id`);--> statement-breakpoint
CREATE TABLE `learning` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`title_ar` text,
	`summary` text,
	`summary_ar` text,
	`body_markdown` text,
	`body_markdown_ar` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`target_at` text,
	`resources` text DEFAULT '[]' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_visible_idx` ON `learning` (`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text,
	`ip_hash` text,
	`stage` text DEFAULT 'password' NOT NULL,
	`success` integer DEFAULT false NOT NULL,
	`reason` text,
	`country` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_idx` ON `login_attempts` (`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_ip_idx` ON `login_attempts` (`ip_hash`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`company` text,
	`project_type` text,
	`budget` text,
	`subject` text,
	`body` text NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`country` text,
	`city` text,
	`ip_hash` text,
	`user_agent` text,
	`visitor_id` text,
	`turnstile_ok` integer DEFAULT false NOT NULL,
	`admin_note` text,
	`replied_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expiry_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`title_ar` text,
	`summary` text,
	`summary_ar` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`kind` text DEFAULT 'single' NOT NULL,
	`entry` text DEFAULT 'index.html' NOT NULL,
	`kv_prefix` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_idx` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_visibility_idx` ON `pages` (`visibility`,`sort_order`);--> statement-breakpoint
CREATE TABLE `pageviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visit_id` integer NOT NULL,
	`visitor_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text,
	`locale` text DEFAULT 'ar' NOT NULL,
	`route_key` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`max_scroll` integer DEFAULT 0 NOT NULL,
	`is_exit` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pageviews_visit_idx` ON `pageviews` (`visit_id`);--> statement-breakpoint
CREATE INDEX `pageviews_path_idx` ON `pageviews` (`path`,`created_at`);--> statement-breakpoint
CREATE INDEX `pageviews_created_idx` ON `pageviews` (`created_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`title_ar` text,
	`excerpt` text,
	`excerpt_ar` text,
	`body_markdown` text,
	`body_markdown_ar` text,
	`cover_url` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`reading_minutes` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_idx` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_status_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`description_ar` text,
	`html_url` text NOT NULL,
	`homepage` text,
	`topics` text DEFAULT '[]' NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`forks` integer DEFAULT 0 NOT NULL,
	`watchers` integer DEFAULT 0 NOT NULL,
	`open_issues` integer DEFAULT 0 NOT NULL,
	`primary_language` text,
	`languages` text DEFAULT '[]' NOT NULL,
	`license` text,
	`is_fork` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_template` integer DEFAULT false NOT NULL,
	`repo_created_at` text,
	`repo_pushed_at` text,
	`size_kb` integer DEFAULT 0 NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`readme_markdown` text,
	`readme_etag` text,
	`readme_fetched_at` integer,
	`has_docs` integer DEFAULT false NOT NULL,
	`detected_doc_mode` text DEFAULT 'readme' NOT NULL,
	`doc_mode` text DEFAULT 'readme' NOT NULL,
	`doc_mode_overridden` integer DEFAULT false NOT NULL,
	`docs_path` text DEFAULT 'docs' NOT NULL,
	`docs_entry` text,
	`docs_file_count` integer DEFAULT 0 NOT NULL,
	`docs_synced_at` integer,
	`override` text,
	`override_title` text,
	`override_title_ar` text,
	`override_category` text,
	`override_summary_ar` text,
	`override_summary_en` text,
	`override_featured` integer,
	`override_hidden` integer,
	`category` text DEFAULT 'other' NOT NULL,
	`category_overridden` integer DEFAULT false NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`latest_release_tag` text,
	`latest_release_name` text,
	`latest_release_at` text,
	`latest_release_notes` text,
	`releases_count` integer DEFAULT 0 NOT NULL,
	`release_downloads` integer DEFAULT 0 NOT NULL,
	`synced_at` integer,
	`sync_state` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_id_idx` ON `projects` (`github_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_idx` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_visibility_idx` ON `projects` (`visible`,`featured`,`sort_order`);--> statement-breakpoint
CREATE INDEX `projects_pushed_idx` ON `projects` (`repo_pushed_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`window_start` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`icon` text DEFAULT 'cube' NOT NULL,
	`title` text NOT NULL,
	`title_ar` text,
	`summary` text,
	`summary_ar` text,
	`body_markdown` text,
	`body_markdown_ar` text,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`price_note` text,
	`price_note_ar` text,
	`stack` text DEFAULT '[]' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_slug_idx` ON `services` (`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`stage` text DEFAULT 'half' NOT NULL,
	`csrf_token` text NOT NULL,
	`ip_hash` text,
	`user_agent` text,
	`country` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`category` text DEFAULT 'other' NOT NULL,
	`level` integer DEFAULT 50 NOT NULL,
	`note` text,
	`note_ar` text,
	`since_year` integer,
	`is_learning` integer DEFAULT false NOT NULL,
	`learning_progress` integer DEFAULT 0 NOT NULL,
	`from_github` integer DEFAULT false NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_idx` ON `skills` (`name`);--> statement-breakpoint
CREATE INDEX `skills_category_idx` ON `skills` (`category`);--> statement-breakpoint
CREATE TABLE `social_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`label` text,
	`label_ar` text,
	`url` text NOT NULL,
	`handle` text,
	`icon` text DEFAULT 'link' NOT NULL,
	`accent` text,
	`visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `social_visible_idx` ON `social_links` (`visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text DEFAULT 'cron' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`repos_seen` integer DEFAULT 0 NOT NULL,
	`repos_created` integer DEFAULT 0 NOT NULL,
	`repos_updated` integer DEFAULT 0 NOT NULL,
	`releases_seen` integer DEFAULT 0 NOT NULL,
	`assets_seen` integer DEFAULT 0 NOT NULL,
	`docs_synced` integer DEFAULT 0 NOT NULL,
	`webhooks_registered` integer DEFAULT 0 NOT NULL,
	`kv_writes` integer DEFAULT 0 NOT NULL,
	`snapshot_commit` text,
	`error` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_idx` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`totp_secret` text,
	`totp_enabled_at` integer,
	`totp_last_counter` integer,
	`recovery_codes` text DEFAULT '[]' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`last_login_country` text,
	`last_login_ip_hash` text,
	`password_changed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visitor_id` text NOT NULL,
	`session_id` text NOT NULL,
	`entry_path` text NOT NULL,
	`last_path` text NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`country` text,
	`country_name` text,
	`city` text,
	`region` text,
	`timezone` text,
	`asn` integer,
	`as_organization` text,
	`continent` text,
	`latitude` real,
	`longitude` real,
	`device` text,
	`device_model` text,
	`browser` text,
	`browser_version` text,
	`os` text,
	`os_version` text,
	`user_agent` text,
	`language` text,
	`screen_width` integer,
	`screen_height` integer,
	`viewport_width` integer,
	`viewport_height` integer,
	`referrer` text,
	`referrer_host` text,
	`source_type` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`ip_hash` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`pageviews` integer DEFAULT 1 NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visits_started_idx` ON `visits` (`started_at`);--> statement-breakpoint
CREATE INDEX `visits_seen_idx` ON `visits` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `visits_visitor_idx` ON `visits` (`visitor_id`);--> statement-breakpoint
CREATE INDEX `visits_country_idx` ON `visits` (`country`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_full_name` text NOT NULL,
	`hook_id` integer,
	`url` text,
	`events` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_delivery_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_repo_idx` ON `webhooks` (`repo_full_name`);