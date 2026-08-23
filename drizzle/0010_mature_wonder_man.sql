CREATE TABLE `workstream_coverage_profiles` (
	`workstreamId` varchar(3) NOT NULL,
	`purpose` enum('KB_DOCUMENTARY_NONCOMMERCIAL') NOT NULL DEFAULT 'KB_DOCUMENTARY_NONCOMMERCIAL',
	`periodStart` varchar(10) NOT NULL DEFAULT '1940-01-01',
	`periodEnd` varchar(10) NOT NULL DEFAULT '2026-08-31',
	`geographyScope` enum('GLOBAL') NOT NULL DEFAULT 'GLOBAL',
	`profileStatus` enum('CONFIGURED_EMPTY') NOT NULL DEFAULT 'CONFIGURED_EMPTY',
	`exclusivityRule` enum('CLAIM_BEFORE_WORK') NOT NULL DEFAULT 'CLAIM_BEFORE_WORK',
	`configuredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workstream_coverage_profiles_workstreamId` PRIMARY KEY(`workstreamId`)
);
--> statement-breakpoint
ALTER TABLE `workstream_coverage_profiles` ADD CONSTRAINT `workstream_coverage_profiles_workstreamId_workstreams_id_fk` FOREIGN KEY (`workstreamId`) REFERENCES `workstreams`(`id`) ON DELETE no action ON UPDATE no action;