CREATE TABLE `forensic_decisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`physicalPieceId` int NOT NULL,
	`field` enum('AUTHENTICITY','MODEL','YEAR','FACTORY','COLOUR','SIZE','MATERIAL','CONDITION') NOT NULL,
	`decision` enum('VERIFIED','SUPPORTED','INCONCLUSIVE','CONTRADICTED') NOT NULL DEFAULT 'INCONCLUSIVE',
	`valueLiteral` text,
	`rationale` text NOT NULL,
	`requiresPhysicalReview` boolean NOT NULL DEFAULT true,
	`reviewedByOpenId` varchar(64),
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forensic_decisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `forensic_decisions_piece_field_unique` UNIQUE(`physicalPieceId`,`field`)
);
--> statement-breakpoint
CREATE TABLE `forensic_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`physicalPieceId` int NOT NULL,
	`visualAssetId` int NOT NULL,
	`category` enum('BRAND_LABEL','REGULATORY_LABEL','IDENTIFIER','LAUREL_MARK','CONSTRUCTION','FASTENING','MEASUREMENT','MATERIAL_SURFACE','ORIGIN_MARK','TEMPORAL_COHERENCE','CONDITION') NOT NULL,
	`targetField` enum('AUTHENTICITY','MODEL','YEAR','FACTORY','COLOUR','SIZE','MATERIAL','CONDITION') NOT NULL,
	`observation` text NOT NULL,
	`locator` text NOT NULL,
	`decision` enum('VERIFIED','SUPPORTED','INCONCLUSIVE','CONTRADICTED') NOT NULL,
	`sourceRef` varchar(1024),
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forensic_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `physical_pieces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pieceRef` varchar(96) NOT NULL,
	`canonicalVariantRef` varchar(96),
	`status` enum('INTAKE','DOCUMENTED','REVIEW_REQUIRED','ARCHIVED') NOT NULL DEFAULT 'INTAKE',
	`sourceContext` text NOT NULL,
	`custodyRef` varchar(1024) NOT NULL,
	`receivedAt` timestamp NOT NULL,
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `physical_pieces_id` PRIMARY KEY(`id`),
	CONSTRAINT `physical_pieces_pieceRef_unique` UNIQUE(`pieceRef`)
);
--> statement-breakpoint
CREATE TABLE `visual_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visualManifestId` int NOT NULL,
	`physicalPieceId` int NOT NULL,
	`role` enum('STD_PRIMARY','STD_REVERSE','STD_PROFILE_A','STD_PROFILE_B','MACRO_BRAND','MACRO_REGULATORY','MACRO_IDENTIFIER','MACRO_CONSTRUCTION','MACRO_SIGNATURE','MACRO_CONDITION') NOT NULL,
	`assetSha256` varchar(64) NOT NULL,
	`storageKey` varchar(1024) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`pixelWidth` int NOT NULL,
	`pixelHeight` int NOT NULL,
	`capturedAt` timestamp NOT NULL,
	`sourceProvenance` text NOT NULL,
	`custodyRef` varchar(1024) NOT NULL,
	`rightsStatus` enum('ACREDITED','UNKNOWN','REJECTED') NOT NULL DEFAULT 'UNKNOWN',
	`rightsEvidenceRef` varchar(1024),
	`scaleStatus` enum('DOCUMENTED','NOT_DOCUMENTED') NOT NULL DEFAULT 'NOT_DOCUMENTED',
	`scaleReference` text,
	`semanticEditStatus` enum('UNEDITED','DOCUMENTED_TRANSFORM','REJECTED') NOT NULL DEFAULT 'UNEDITED',
	`createdByOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visual_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `visual_assets_assetSha256_unique` UNIQUE(`assetSha256`),
	CONSTRAINT `visual_assets_manifest_role_unique` UNIQUE(`visualManifestId`,`role`)
);
--> statement-breakpoint
CREATE TABLE `visual_manifests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`physicalPieceId` int NOT NULL,
	`manifestStatus` enum('INCOMPLETE','READY_FOR_REVIEW','VALIDATED','BLOCKED') NOT NULL DEFAULT 'INCOMPLETE',
	`standardViewCount` int NOT NULL DEFAULT 0,
	`macroCount` int NOT NULL DEFAULT 0,
	`validatedByOpenId` varchar(64),
	`validatedAt` timestamp,
	`blockReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `visual_manifests_id` PRIMARY KEY(`id`),
	CONSTRAINT `visual_manifests_physicalPieceId_unique` UNIQUE(`physicalPieceId`)
);
--> statement-breakpoint
ALTER TABLE `forensic_decisions` ADD CONSTRAINT `fd_piece_fk` FOREIGN KEY (`physicalPieceId`) REFERENCES `physical_pieces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `forensic_observations` ADD CONSTRAINT `fo_piece_fk` FOREIGN KEY (`physicalPieceId`) REFERENCES `physical_pieces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `forensic_observations` ADD CONSTRAINT `fo_asset_fk` FOREIGN KEY (`visualAssetId`) REFERENCES `visual_assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visual_assets` ADD CONSTRAINT `va_manifest_fk` FOREIGN KEY (`visualManifestId`) REFERENCES `visual_manifests`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visual_assets` ADD CONSTRAINT `va_piece_fk` FOREIGN KEY (`physicalPieceId`) REFERENCES `physical_pieces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visual_manifests` ADD CONSTRAINT `vm_piece_fk` FOREIGN KEY (`physicalPieceId`) REFERENCES `physical_pieces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `forensic_decisions_status_idx` ON `forensic_decisions` (`decision`);--> statement-breakpoint
CREATE INDEX `forensic_observations_piece_idx` ON `forensic_observations` (`physicalPieceId`,`targetField`);--> statement-breakpoint
CREATE INDEX `physical_pieces_variant_idx` ON `physical_pieces` (`canonicalVariantRef`);--> statement-breakpoint
CREATE INDEX `visual_assets_piece_idx` ON `visual_assets` (`physicalPieceId`);--> statement-breakpoint
CREATE INDEX `visual_assets_rights_idx` ON `visual_assets` (`rightsStatus`);