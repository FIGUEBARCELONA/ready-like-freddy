CREATE TABLE `canonical_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`canonicalImportId` int NOT NULL,
	`variantRef` varchar(96) NOT NULL,
	`productCode` varchar(96),
	`modelName` varchar(191),
	`sourceLocator` varchar(1024) NOT NULL,
	`sourceSha256` varchar(64) NOT NULL,
	`status` enum('VERIFIED','INCONCLUSIVE','BLOCKED') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `canonical_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `canonical_variants_variantRef_unique` UNIQUE(`variantRef`)
);
--> statement-breakpoint
ALTER TABLE `canonical_variants` ADD CONSTRAINT `canonical_variants_canonicalImportId_canonical_imports_id_fk` FOREIGN KEY (`canonicalImportId`) REFERENCES `canonical_imports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `canonical_variants_import_idx` ON `canonical_variants` (`canonicalImportId`);