import type {Lane} from '@/lib/lanes';

export const MARKETPLACES=[
  'ebay.','vinted.','wallapop.','depop.','etsy.','amazon.','facebook.com','instagram.com','pinterest.','reddit.com','youtube.com','tiktok.com',
  'grailed.com','vestiairecollective.','shpock.','olx.','allegro.','leboncoin.fr','2dehands.','marktplaats.nl','kleinanzeigen.de','catawiki.','tradera.',
  'finn.no','tori.fi','willhaben.at','marketplace.','poshmark.com','subito.it','carousell.','mercari.','rakuten.','chrono24.','vendora.bg','bazar.bg',
  'wikipedia.org','yelp.','thelabelfinder.','worthpoint.com','bazos.','plick.','adverts.ie','goldenpages.','gem.app','glami.','therealreal.com',
];

export const NEW_RETAIL=[
  'fredperry.com','asos.com','endclothing.com','stuartslondon.com','dandyfellow.com','farfetch.com','zalando.','aboutyou.','yoox.com','mrporter.com','ssense.com',
  'mainlinemenswear.com','arnotts.ie','boozt.com','miinto.','bstn.com','size.co.uk','flannels.com','julesb.co.uk','kingpinclothingstore.com',
];

export const UK_OPERATORS=['headlock.co','roundrobinclassics.com','mainlinemenswear.com','thrifted.com','freshmansarchive.com','messinahembry.com','brasshanger.co.uk','preworn.com','rokit.co.uk','ie.rokit.co.uk','vintagerecovery.co.uk','livefortweed.co.uk'];
export const INTERNAL=['google.com','googleusercontent.com','gstatic.com','yahoo.com','yahoo.net','bing.com','microsoft.com'];
export const PRELOVED=['vintage','second hand','secondhand','preloved','pre-loved','pre owned','pre-owned','used clothing','seconde main','friperie','occasion','gebraucht','zweite hand','tweedehands','kringloop','usato','seconda mano','segunda mano','segunda mão','odzież używana','használt','rabljena','použité','genbrug','käytetyt','lietoti','dėvėti','дрехи втора употреба','μεταχειρισμένα','haine second hand','kasutatud riided','vintage kleding','abbigliamento vintage','ropa vintage','roupa vintage','odzież vintage','haine vintage','retro clothing','archive clothing'];
export const PROFESSIONAL=['add to cart','add to bag','basket','checkout','shop now','buy now','shipping','delivery','returns','return policy','terms and conditions','contact us','about us','ajouter au panier','in den warenkorb','aggiungi al carrello','añadir al carrito','adicionar ao carrinho','toevoegen aan winkelwagen','lägg i varukorg','dodaj do koszyka','tilføj til kurv','retour','versand','spedizione','livrare','plată','zahlung','refund policy','shipping policy'];
export const LEGAL=['vat','iva','nif','cif','p.iva','partita iva','btw','kvk','siret','siren','ust-id','ust-idnr','ust-idnr.','company number','registration number','impressum','legal notice','mentions légales','aviso legal','privacy policy','regulamin','cui','registrul comerțului','firmenbuch','uid-nummer','geschäftsführer','amtsgericht','organisationsnummer','aktiebolag','limited company','s.r.o.','sp. z o.o.','srl','s.r.l.','gmbh','ab'];
export const PURCHASE=['add to cart','add to bag','buy now','checkout','ajouter au panier','in den warenkorb','aggiungi al carrello','añadir al carrito','adicionar ao carrinho','dodaj do koszyka','toevoegen aan winkelwagen','adaugă în coș'];
export const NEGATIVE='-ebay -vinted -wallapop -depop -etsy -amazon -poshmark -subito -grailed -vestiaire -leboncoin -olx -marktplaats -2dehands -kleinanzeigen -catawiki -reddit -wikipedia -yelp -zalando -asos -farfetch -vendora -bazar';

export const EU_TLDS=new Set(['at','be','bg','hr','cy','cz','dk','ee','fi','fr','de','gr','hu','ie','it','lv','lt','lu','mt','nl','pl','pt','ro','sk','si','es','se']);
export const NON_EU_TLDS=new Set(['uk','co.uk','com.au','ca','ch','no','us','co.nz']);
export const VAT_PREFIX_TO_COUNTRY:Record<string,string>={AT:'AT',BE:'BE',BG:'BG',CY:'CY',CZ:'CZ',DE:'DE',DK:'DK',EE:'EE',EL:'GR',GR:'GR',ES:'ES',FI:'FI',FR:'FR',HR:'HR',HU:'HU',IE:'IE',IT:'IT',LT:'LT',LU:'LU',LV:'LV',MT:'MT',NL:'NL',PL:'PL',PT:'PT',RO:'RO',SE:'SE',SI:'SI',SK:'SK'};
export const COUNTRY_NAMES:Record<string,string[]>={
  AT:['austria','österreich'],BE:['belgium','belgië','belgique'],BG:['bulgaria','българия'],HR:['croatia','hrvatska'],CY:['cyprus','κύπρος'],CZ:['czech republic','czechia','česká republika'],DK:['denmark','danmark'],EE:['estonia','eesti'],FI:['finland','suomi'],FR:['france'],DE:['germany','deutschland'],GR:['greece','ελλάδα'],HU:['hungary','magyarország'],IE:['ireland'],IT:['italy','italia'],LV:['latvia','latvija'],LT:['lithuania','lietuva'],LU:['luxembourg'],MT:['malta'],NL:['netherlands','nederland'],PL:['poland','polska'],PT:['portugal'],RO:['romania','românia'],SK:['slovakia','slovensko'],SI:['slovenia','slovenija'],ES:['spain','españa'],SE:['sweden','sverige'],
};

export const QUERIES:Array<(lane:Lane)=>string>=[
  lane=>`site:.${lane.tld} "Fred Perry" ${lane.localSecondhand} shop`,
  lane=>`site:.${lane.tld} "Fred Perry" vintage boutique`,
  lane=>`site:.${lane.tld} inurl:products "Fred Perry" vintage`,
  lane=>`site:.${lane.tld} inurl:collections "Fred Perry" second hand`,
  lane=>`site:.${lane.tld} "Fred Perry" "add to cart" vintage`,
  lane=>`site:.${lane.tld} "Fred Perry" "contact" ${lane.localSecondhand}`,
  lane=>`"Fred Perry" ${lane.localSecondhand} boutique ${lane.country}`,
  lane=>`"Fred Perry" vintage clothing store ${lane.country}`,
  lane=>`"Fred Perry" second hand ecommerce ${lane.country}`,
  lane=>`"Fred Perry" preloved menswear ${lane.country}`,
  lane=>`"Fred Perry" cardigan sweater track jacket vintage ${lane.country}`,
  lane=>`"Fred Perry" polo shirt ${lane.localSecondhand} ${lane.country}`,
  lane=>`"Fred Perry" consignment clothing ${lane.country}`,
  lane=>`"Fred Perry" used clothing boutique ${lane.country}`,
  lane=>`"Fred Perry" archive vintage shop ${lane.country}`,
  lane=>`"Fred Perry" retro clothing shop ${lane.country}`,
  lane=>`"Fred Perry" secondhand webshop ${lane.country}`,
  lane=>`"Fred Perry" vintage store "${lane.country}" "returns"`,
  lane=>`"Fred Perry" ${lane.localSecondhand} "shipping" ${lane.country}`,
  lane=>`"Fred Perry" vintage "impressum" ${lane.country}`,
  lane=>`"Fred Perry" vintage "legal notice" ${lane.country}`,
  lane=>`"Fred Perry" vintage "contact us" ${lane.country}`,
  lane=>`"Fred Perry" authentic vintage ${lane.country}`,
  lane=>`"Fred Perry" curated second hand ${lane.country}`,
];
