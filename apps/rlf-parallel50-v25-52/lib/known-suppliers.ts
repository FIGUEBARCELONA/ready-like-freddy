export const CANONICAL_REGISTRY_EXPECTED_IDENTITIES=154 as const;
export const CANONICAL_REGISTRY_SOURCE='RLF_MASTER_PROVEIDORS_PRODUCTES_v24_DELTA_0044_PARALLEL50_2026-08-23.xlsx' as const;

export const KNOWN_SUPPLIER_DOMAINS=new Set([
  '2ndfit.de','37casual.de','86casual.de','96casual.de','alabamavintageshop.com','archetype.pl','asti.mercatopoli.it','back2grandvintage.com','barriquevintageshop.com','bettertimesclothing.de','buddyandselly.com','casualvintage.com','chakmarluxe.be','claquettesmarket.com','clothes4you.pl','clothest.it','culturavintage.es','dedstrangevintage.com','dimanoinmano.it','doubledoublevintage.com','emmeintheworld.it','fangovintage.com','forgotten-fabrics.com','gems-vintage.de','goofysanta.de','gtuned-vintage.de','impalavintage.com','jaama.de','kilo-shop.com','kindakinks.es','kingkongathensvintage.gr','kurvengaenger.com','ledestinsportif.com','lemonsvintage.com','lennysvintage.de','lifelongtrends.com','lisbeths-erben.de','loopwestcoast.se','lote751vintage.com','megasecondhand.cz','mercatodelleoccasioni.it','micolet.com','micolet.pt','modz.fr','mojetvoje-secondhand.si','momoxfashion.com','nabevintage.com','northerngrip.com','olesstore.com','onceagain.fr','orzinuovi.mercatopoli.it','paavlikaltsukas.ee','paulsboutiqueberlin.de','peeces.de','percentil.fr','picknweight.de','popbag.it','prelovedbaby.it','preownedcasuals.de','pretachanger.fr','rare-rags.de','re-nato.it','remixshop.com','retroarea.de','retrospectclothes.com','rodekorsgenbrug.dk','rostreetwear.com','rostreewear.com','rostretwear.com','rude-times.de','santospiritovintage.com','saronno.mercatopoli.it','second-soul.de','secondamanina.it','secondhandrosi.de','secondshot.cz','sellpy.com','sonnechko.com','stillthrifting.de','store.emmy.fi','stuffle.com','thesecondlife.fr','think2.eu','thrift.cz','thrifted.mt','thrifttale.com','tilt-vintage.com','tntvintageclothing.com','tobiastore.com','vecchiostilevintageshop.com','vidanovapdl.com','vinokilo.events','vintage-rags.de','vintageecoes.com','vintagehere.com','vintager2.de','vintageshit.de','vintagesportsclothing.com','weighnpay.ie'
]);

export const KNOWN_SUPPLIER_ALIAS_DOMAINS=new Set([
  'sellpy.fr','sellpy.se','sellpy.de','sellpy.nl','sellpy.fi','sellpy.dk','sellpy.at','sellpy.be'
]);

export const STAGED_SUPPLIER_DOMAINS=new Set([
  'vintagehere.com','thrift.cz','vintagesportsclothing.com','vidanovapdl.com','fangovintage.com','tobiastore.com','vecchiostilevintageshop.com','rostreetwear.com','olesstore.com','doubledoublevintage.com','buddyandselly.com','loopwestcoast.se'
]);

export const KNOWN_IDENTITY_KEYS=new Set([
  'PL-NIP:8822134274','CZ-ICO:14416042','CZ-ICO:75203529','EU-VAT:PT198687974','PT-NIF:517429926','IT-PIVA:07431160485','EU-VAT:IT09981061212','EU-VAT:IT10440021219','RO-CUI:41820792','PL-NIP:8311563399','IT-CF:90036170513','ES-NIF:E52539293','EU-VAT:FR43507928935','FR-SIRET:50792893500109','EU-VAT:IT12896370157','EU-VAT:IT10676760019','EU-VAT:IT03423160989','EU-VAT:IT01321480053','IE-CRO:599102','EU-VAT:IE9331506J','EU-VAT:DE452397519','DK-CVR:20700211'
]);

export const KNOWN_REJECTED_DOMAINS=new Set([
  '2dehands.be','adverts.ie','annuaire-entreprises.data.gouv.fr','atticadps.gr','aukia.fi','bazar.bg','bizi.si','bstrongoutlet.pt','comparer.be','cybo.com','deblauwezebra.be','einforma.pt','elcorteingles.pt','entreprises.lefigaro.fr','espacemode.be','excelclothing.ie','factoryoutlet.gr','fashiola.com','fashiola.de','fashiola.fr','footshop.hu','footshop.sk','fratellirossishop.it','fredperryoutlet.de','fredperryoutletus.com','fredperryus.com','fredsperryonlineshop.de','gem.app','goldenpages.ie','headlock.co','index.hr','inno.be','jame.pt','jofogas.hu','joinfleek.com','kingpinclothingstore.com','kuantokusta.pt','kurpirkt.lv','ladc.be','laredoute.fr','loopi.com','mainlinemenswear.com','mapcarta.com','marquessoares.pt','maufeitio.pt','milanuncios.com','miravia.es','myrorna.se','near-place.com','next.com.mt','nextdirect.com','novacircle.com','olondon.fr','one4all.mt','outletaholic.com','pagesjaunes.fr','pagesmode.com','pappers.fr','pirs.si','pointcarre.be','prm.com','rebirthofcool.ie','rihu.pt','roundrobinclassics.com','segunda-mano.pro','seitcheck.de','shoes.fr','shop.maniet.be','showroom.pl','skroutz.gr','sportino.pt','sprzedajemy.pl','stockholmfashiondistrict.se','stockverkopen.nl','streetwear.sk','suitable.be','taobao.com','the-gentlemen-store.de','thegentlemensvault.nl','thelabelfinder.com','toms-paderborn.de','twintipuk.myshopify.com','validate.perfdrive.com','vatera.hu','vendora.bg','vintageclothingguides.com','web2.cylex.de','wikipedia.org','world.taobao.com','worthpoint.com','xtreme.pt','yellow.com.mt','yelp.com','zedstore.it'
]);

export const KNOWN_IDENTITY_QUARANTINE_DOMAINS=new Set([
  'vintagegyvulys.com','vintagecloset.gr','vintagebulgariashop.com'
]);

export const CANONICAL_REGISTRY_COVERAGE={
  expectedIdentities:CANONICAL_REGISTRY_EXPECTED_IDENTITIES,
  materializedDomains:KNOWN_SUPPLIER_DOMAINS.size,
  materializedAliasDomains:KNOWN_SUPPLIER_ALIAS_DOMAINS.size,
  materializedIdentityKeys:KNOWN_IDENTITY_KEYS.size,
  identityQuarantineDomains:KNOWN_IDENTITY_QUARANTINE_DOMAINS.size,
  complete:false,
  acceptanceMode:'MANUAL_MASTER_DEDUP_REQUIRED' as const,
  source:CANONICAL_REGISTRY_SOURCE,
};
