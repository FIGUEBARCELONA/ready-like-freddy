export const CANONICAL_REGISTRY_EXPECTED_IDENTITIES=151 as const;
export const CANONICAL_REGISTRY_SOURCE='RLF_MASTER_PROVEIDORS_PRODUCTES_v24_DELTA_0044_PARALLEL50_2026-08-23.xlsx' as const;

export const KNOWN_SUPPLIER_DOMAINS=new Set([
  '2ndfit.de','37casual.de','86casual.de','alabamavintageshop.com','archetype.pl','asti.mercatopoli.it','back2grandvintage.com','barriquevintageshop.com','bettertimesclothing.de','buddyandselly.com','casualvintage.com','chakmarluxe.be','claquettesmarket.com','clothes4you.pl','clothest.it','culturavintage.es','dedstrangevintage.com','dimanoinmano.it','doubledoublevintage.com','emmeintheworld.it','fangovintage.com','forgotten-fabrics.com','gems-vintage.de','goofysanta.de','gtuned-vintage.de','impalavintage.com','jaama.de','kilo-shop.com','kindakinks.es','kingkongathensvintage.gr','kurvengaenger.com','ledestinsportif.com','lemonsvintage.com','lennysvintage.de','lifelongtrends.com','lisbeths-erben.de','loopwestcoast.se','lote751vintage.com','mercatodelleoccasioni.it','micolet.com','micolet.pt','modz.fr','mojetvoje-secondhand.si','momoxfashion.com','nabevintage.com','northerngrip.com','olesstore.com','onceagain.fr','orzinuovi.mercatopoli.it','paavlikaltsukas.ee','paulsboutiqueberlin.de','peeces.de','percentil.fr','picknweight.de','popbag.it','prelovedbaby.it','preownedcasuals.de','pretachanger.fr','rare-rags.de','re-nato.it','remixshop.com','retroarea.de','retrospectclothes.com','rostreetwear.com','rostreewear.com','rostretwear.com','rude-times.de','santospiritovintage.com','saronno.mercatopoli.it','second-soul.de','secondamanina.it','secondhandrosi.de','secondshot.cz','sellpy.com','sonnechko.com','stillthrifting.de','store.emmy.fi','stuffle.com','thesecondlife.fr','think2.eu','thrift.cz','thrifted.mt','thrifttale.com','tilt-vintage.com','tntvintageclothing.com','tobiastore.com','vecchiostilevintageshop.com','vidanovapdl.com','vinokilo.events','vintage-rags.de','vintageecoes.com','vintagehere.com','vintager2.de','vintageshit.de','vintagesportsclothing.com'
]);

export const STAGED_SUPPLIER_DOMAINS=new Set([
  'vintagehere.com','thrift.cz','vintagesportsclothing.com','vidanovapdl.com','fangovintage.com','tobiastore.com','vecchiostilevintageshop.com','rostreetwear.com','olesstore.com','doubledoublevintage.com','buddyandselly.com','loopwestcoast.se'
]);

export const KNOWN_IDENTITY_KEYS=new Set([
  'PL-NIP:8822134274','CZ-ICO:14416042','EU-VAT:PT198687974','PT-NIF:517429926','IT-PIVA:07431160485','EU-VAT:IT09981061212','EU-VAT:IT10440021219','RO-CUI:41820792','PL-NIP:8311563399','IT-CF:90036170513','ES-NIF:E52539293','EU-VAT:FR43507928935','FR-SIRET:50792893500109','EU-VAT:IT12896370157','EU-VAT:IT10676760019','EU-VAT:IT03423160989','EU-VAT:IT01321480053'
]);

export const KNOWN_REJECTED_DOMAINS=new Set([
  '2dehands.be','adverts.ie','bazar.bg','cybo.com','fashiola.com','fashiola.de','fashiola.fr','gem.app','goldenpages.ie','headlock.co','joinfleek.com','kingpinclothingstore.com','kurpirkt.lv','loopi.com','mainlinemenswear.com','mapcarta.com','near-place.com','novacircle.com','one4all.mt','pagesmode.com','roundrobinclassics.com','stockholmfashiondistrict.se','taobao.com','thelabelfinder.com','twintipuk.myshopify.com','vendora.bg','vintageclothingguides.com','wikipedia.org','world.taobao.com','worthpoint.com','yellow.com.mt','yelp.com'
]);

export const KNOWN_IDENTITY_QUARANTINE_DOMAINS=new Set([
  'vintagegyvulys.com','vintagecloset.gr','vintagebulgariashop.com'
]);

export const CANONICAL_REGISTRY_COVERAGE={
  expectedIdentities:CANONICAL_REGISTRY_EXPECTED_IDENTITIES,
  materializedDomains:KNOWN_SUPPLIER_DOMAINS.size,
  materializedIdentityKeys:KNOWN_IDENTITY_KEYS.size,
  identityQuarantineDomains:KNOWN_IDENTITY_QUARANTINE_DOMAINS.size,
  complete:false,
  acceptanceMode:'MANUAL_MASTER_DEDUP_REQUIRED' as const,
  source:CANONICAL_REGISTRY_SOURCE,
};
