CREATE TABLE `audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(96) NOT NULL,
	`workstreamId` varchar(3),
	`workItemId` int,
	`incidentId` int,
	`actorOpenId` varchar(64) NOT NULL,
	`previousState` json,
	`nextState` json,
	`reason` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calibration_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`calibrationRunId` int NOT NULL,
	`metricKey` varchar(128) NOT NULL,
	`metricValue` varchar(191) NOT NULL,
	`evidenceRef` varchar(1024) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `calibration_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calibration_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`sourceImportId` int,
	`sourceSha256` varchar(64) NOT NULL,
	`status` enum('DRAFT','VERIFIED','REJECTED') NOT NULL DEFAULT 'DRAFT',
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`verifiedAt` timestamp,
	CONSTRAINT `calibration_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canonical_import_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`canonicalImportId` int NOT NULL,
	`entryKey` varchar(191) NOT NULL,
	`entrySha256` varchar(64) NOT NULL,
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `canonical_import_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canonical_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`manifestName` varchar(191) NOT NULL,
	`sourcePath` varchar(1024) NOT NULL,
	`sourceSha256` varchar(64) NOT NULL,
	`sourceVersion` varchar(128) NOT NULL,
	`importStatus` enum('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`entryCount` int NOT NULL DEFAULT 0,
	`verifiedByOpenId` varchar(64),
	`verifiedAt` timestamp,
	`rejectionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `canonical_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workstreamId` varchar(3),
	`workItemId` int,
	`severity` enum('BLOCKING','CONDITIONING','INFORMATIONAL') NOT NULL,
	`status` enum('OPEN','INVESTIGATING','RESOLVED','ESCALATED') NOT NULL DEFAULT 'OPEN',
	`title` varchar(220) NOT NULL,
	`detail` text NOT NULL,
	`openedByOpenId` varchar(64) NOT NULL,
	`resolvedByOpenId` varchar(64),
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reassignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workItemId` int NOT NULL,
	`fromWorkstreamId` varchar(3),
	`toWorkstreamId` varchar(3) NOT NULL,
	`reason` text NOT NULL,
	`actorOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reassignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verification_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cacheKey` varchar(191) NOT NULL,
	`subjectType` varchar(64) NOT NULL,
	`subjectId` varchar(128) NOT NULL,
	`sourceUrl` varchar(1024) NOT NULL,
	`locale` varchar(32) NOT NULL,
	`contentSha256` varchar(64) NOT NULL,
	`observedAt` timestamp NOT NULL,
	`locator` text NOT NULL,
	`cacheStatus` enum('VALID','INVALIDATED','SUPERSEDED') NOT NULL DEFAULT 'VALID',
	`invalidationReason` text,
	`supersedesCacheKey` varchar(191),
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`invalidatedAt` timestamp,
	CONSTRAINT `verification_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `verification_cache_cacheKey_unique` UNIQUE(`cacheKey`)
);
--> statement-breakpoint
CREATE TABLE `work_item_dependencies` (
	`workItemId` int NOT NULL,
	`dependsOnWorkItemId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_item_dependencies_workItemId_dependsOnWorkItemId_pk` PRIMARY KEY(`workItemId`,`dependsOnWorkItemId`)
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(64) NOT NULL,
	`title` varchar(220) NOT NULL,
	`description` text,
	`workstreamId` varchar(3),
	`status` enum('QUEUED','WAITING_DEPENDENCY','READY','IN_PROGRESS','BLOCKED','COMPLETE','FAILED','CANCELLED') NOT NULL DEFAULT 'QUEUED',
	`priority` int NOT NULL DEFAULT 100,
	`isReadOnly` boolean NOT NULL DEFAULT true,
	`requiresCanonicalEvidence` boolean NOT NULL DEFAULT true,
	`createdByOpenId` varchar(64) NOT NULL,
	`assignedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_items_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `workstreams` (
	`id` varchar(3) NOT NULL,
	`title` varchar(160) NOT NULL,
	`status` enum('NOT_STARTED','READY','ACTIVE','BLOCKED','PAUSED','COMPLETE','FAILED') NOT NULL DEFAULT 'NOT_STARTED',
	`capacity` int NOT NULL DEFAULT 1,
	`activeLoad` int NOT NULL DEFAULT 0,
	`dependencySummary` text,
	`ownerOpenId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workstreams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_workstreamId_workstreams_id_fk` FOREIGN KEY (`workstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_workItemId_work_items_id_fk` FOREIGN KEY (`workItemId`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `calibration_metrics` ADD CONSTRAINT `calibration_metrics_calibrationRunId_calibration_runs_id_fk` FOREIGN KEY (`calibrationRunId`) REFERENCES `calibration_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `calibration_runs` ADD CONSTRAINT `calibration_runs_sourceImportId_canonical_imports_id_fk` FOREIGN KEY (`sourceImportId`) REFERENCES `canonical_imports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `canonical_import_entries` ADD CONSTRAINT `cie_import_fk` FOREIGN KEY (`canonicalImportId`) REFERENCES `canonical_imports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_workstreamId_workstreams_id_fk` FOREIGN KEY (`workstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_workItemId_work_items_id_fk` FOREIGN KEY (`workItemId`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reassignments` ADD CONSTRAINT `reassignments_workItemId_work_items_id_fk` FOREIGN KEY (`workItemId`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reassignments` ADD CONSTRAINT `reassignments_fromWorkstreamId_workstreams_id_fk` FOREIGN KEY (`fromWorkstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reassignments` ADD CONSTRAINT `reassignments_toWorkstreamId_workstreams_id_fk` FOREIGN KEY (`toWorkstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_item_dependencies` ADD CONSTRAINT `wid_item_fk` FOREIGN KEY (`workItemId`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_item_dependencies` ADD CONSTRAINT `wid_depends_fk` FOREIGN KEY (`dependsOnWorkItemId`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_items` ADD CONSTRAINT `work_items_workstreamId_workstreams_id_fk` FOREIGN KEY (`workstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_events_workstream_idx` ON `audit_events` (`workstreamId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_events_item_idx` ON `audit_events` (`workItemId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `calibration_metrics_run_idx` ON `calibration_metrics` (`calibrationRunId`);--> statement-breakpoint
CREATE INDEX `canonical_import_entries_import_idx` ON `canonical_import_entries` (`canonicalImportId`);--> statement-breakpoint
CREATE INDEX `canonical_imports_status_idx` ON `canonical_imports` (`importStatus`);--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`);--> statement-breakpoint
CREATE INDEX `verification_cache_subject_idx` ON `verification_cache` (`subjectType`,`subjectId`);--> statement-breakpoint
CREATE INDEX `verification_cache_status_idx` ON `verification_cache` (`cacheStatus`);--> statement-breakpoint
CREATE INDEX `work_items_status_priority_idx` ON `work_items` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `work_items_workstream_idx` ON `work_items` (`workstreamId`);
