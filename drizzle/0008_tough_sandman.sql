ALTER TABLE `physical_pieces` MODIFY COLUMN `canonicalVariantRef` varchar(96) NOT NULL;--> statement-breakpoint
ALTER TABLE `physical_pieces` ADD `canonicalVariantEvidenceRef` varchar(1024) NOT NULL;