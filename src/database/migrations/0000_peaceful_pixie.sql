CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`draft_message` text NOT NULL,
	`edited_message` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`confirmation_token_hash` text,
	`confirmation_expires_at` text,
	`confirmed_at` text,
	`sent_at` text,
	`external_message_id` text,
	`failure_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `applications_user_idx` ON `applications` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`linq_chat_id` text NOT NULL,
	`current_state` text DEFAULT 'NEW' NOT NULL,
	`state_payload` text DEFAULT '{}' NOT NULL,
	`active_batch_id` text,
	`last_inbound_message_id` text,
	`last_outbound_message_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_linq_chat_idx` ON `conversations` (`linq_chat_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text,
	`address` text,
	`starts_at` text,
	`ends_at` text,
	`renewal_search_at` text,
	`renewal_reminder_sent_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leases_renewal_idx` ON `leases` (`renewal_search_at`);--> statement-breakpoint
CREATE TABLE `listing_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`search_run_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`control_message_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_run_id`) REFERENCES `search_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `listing_batches_user_idx` ON `listing_batches` (`user_id`);--> statement-breakpoint
CREATE TABLE `listing_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`batch_id` text,
	`decision` text DEFAULT 'unseen' NOT NULL,
	`source` text DEFAULT 'system' NOT NULL,
	`source_message_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_decisions_user_listing_idx` ON `listing_decisions` (`user_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `listing_presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`summary_message_id` text,
	`media_message_id` text,
	`link_message_id` text,
	`presentation_order` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `listing_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `listing_presentations_batch_idx` ON `listing_presentations` (`batch_id`);--> statement-breakpoint
CREATE INDEX `listing_presentations_summary_msg_idx` ON `listing_presentations` (`summary_message_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_listing_id` text NOT NULL,
	`canonical_url` text,
	`title` text NOT NULL,
	`description` text,
	`address` text,
	`city` text NOT NULL,
	`area` text,
	`latitude` real,
	`longitude` real,
	`monthly_rent` integer NOT NULL,
	`currency` text DEFAULT 'SEK' NOT NULL,
	`rooms` real,
	`size_square_meters` integer,
	`furnished` integer,
	`available_from` text,
	`available_to` text,
	`minimum_rental_months` integer,
	`amenities` text DEFAULT '[]' NOT NULL,
	`image_urls` text DEFAULT '[]' NOT NULL,
	`contact_capability` text DEFAULT 'manual_handoff' NOT NULL,
	`provider_metadata` text DEFAULT '{}' NOT NULL,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_provider_ref_idx` ON `listings` (`provider`,`provider_listing_id`);--> statement-breakpoint
CREATE TABLE `outbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`conversation_id` text,
	`linq_chat_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_preview` text,
	`linq_message_id` text,
	`dry_run` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_messages_key_idx` ON `outbound_messages` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`city` text,
	`preferred_areas` text DEFAULT '[]' NOT NULL,
	`excluded_areas` text DEFAULT '[]' NOT NULL,
	`maximum_monthly_rent` integer,
	`currency` text DEFAULT 'SEK' NOT NULL,
	`preferred_move_in_date` text,
	`minimum_rental_months` integer,
	`minimum_rooms` real,
	`minimum_size_square_meters` integer,
	`furnished_preference` text DEFAULT 'no_preference' NOT NULL,
	`max_commute_minutes` integer,
	`commute_modes` text DEFAULT '["bicycle"]' NOT NULL,
	`required_amenities` text DEFAULT '[]' NOT NULL,
	`preferred_amenities` text DEFAULT '[]' NOT NULL,
	`free_text_preferences` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_profiles_user_idx` ON `search_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `search_results` (
	`id` text PRIMARY KEY NOT NULL,
	`search_run_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`score` real NOT NULL,
	`score_breakdown` text DEFAULT '{}' NOT NULL,
	`ranking_position` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`search_run_id`) REFERENCES `search_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_results_run_idx` ON `search_results` (`search_run_id`);--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`search_profile_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	`error_message` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`linq_handle` text NOT NULL,
	`full_name` text,
	`email` text,
	`contact_phone` text,
	`preferred_language` text DEFAULT 'en' NOT NULL,
	`accepted_university_id` text,
	`selected_campus_id` text,
	`consent_to_store_profile` integer DEFAULT false NOT NULL,
	`consent_to_share_contact_details` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_linq_handle_idx` ON `users` (`linq_handle`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`trace_id` text,
	`status` text DEFAULT 'received' NOT NULL,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`processed_at` text,
	`failure_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_event_idx` ON `webhook_events` (`provider_event_id`);