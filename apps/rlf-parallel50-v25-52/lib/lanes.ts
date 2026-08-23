export type Lane={slot:string;countryCode:string;country:string;language:string;tld:string;localSecondhand:string;index:number};

const rows:[string,string,string,string,string][]=[
['AT','Austria','de-AT,de;q=.9,en;q=.7','at','gebrauchte kleidung'],
['BE','Belgium','nl-BE,nl;q=.9,fr;q=.8,en;q=.7','be','tweedehands kleding'],
['BG','Bulgaria','bg-BG,bg;q=.9,en;q=.7','bg','дрехи втора употреба'],
['HR','Croatia','hr-HR,hr;q=.9,en;q=.7','hr','rabljena odjeća'],
['CY','Cyprus','en-CY,en;q=.9,el;q=.8','cy','second hand clothing'],
['CZ','Czechia','cs-CZ,cs;q=.9,en;q=.7','cz','použité oblečení'],
['DK','Denmark','da-DK,da;q=.9,en;q=.7','dk','genbrugstøj'],
['EE','Estonia','et-EE,et;q=.9,en;q=.7','ee','kasutatud riided'],
['FI','Finland','fi-FI,fi;q=.9,en;q=.7','fi','käytetyt vaatteet'],
['FR','France','fr-FR,fr;q=.9,en;q=.7','fr','vêtements seconde main'],
['DE','Germany','de-DE,de;q=.9,en;q=.7','de','second hand kleidung'],
['GR','Greece','el-GR,el;q=.9,en;q=.7','gr','μεταχειρισμένα ρούχα'],
['HU','Hungary','hu-HU,hu;q=.9,en;q=.7','hu','használt ruha'],
['IE','Ireland','en-IE,en;q=.9','ie','preloved clothing'],
['IT','Italy','it-IT,it;q=.9,en;q=.7','it','abbigliamento usato'],
['LV','Latvia','lv-LV,lv;q=.9,en;q=.7','lv','lietoti apģērbi'],
['LT','Lithuania','lt-LT,lt;q=.9,en;q=.7','lt','dėvėti drabužiai'],
['LU','Luxembourg','fr-LU,fr;q=.9,de;q=.8,en;q=.7','lu','vêtements seconde main'],
['MT','Malta','en-MT,en;q=.9','mt','preloved clothing'],
['NL','Netherlands','nl-NL,nl;q=.9,en;q=.7','nl','tweedehands kleding'],
['PL','Poland','pl-PL,pl;q=.9,en;q=.7','pl','odzież używana'],
['PT','Portugal','pt-PT,pt;q=.9,en;q=.7','pt','roupa em segunda mão'],
['RO','Romania','ro-RO,ro;q=.9,en;q=.7','ro','haine second hand'],
['SK','Slovakia','sk-SK,sk;q=.9,en;q=.7','sk','použité oblečenie'],
['SI','Slovenia','sl-SI,sl;q=.9,en;q=.7','si','rabljena oblačila'],
['ES','Spain','es-ES,es;q=.9,ca;q=.8,en;q=.7','es','ropa de segunda mano'],
['SE','Sweden','sv-SE,sv;q=.9,en;q=.7','se','second hand kläder'],
];

const extra=['DE','FR','IT','ES','PL','NL','BE','PT','SE','DK','FI','AT','CZ','RO','GR','HU','IE','HR','SK','SI','BG','LT','EE'];

export const LANES:Lane[]=[...rows,...extra.map(code=>rows.find(row=>row[0]===code)!)].map((row,index)=>({
  slot:`F${String(index+1).padStart(2,'0')}`,
  countryCode:row[0],
  country:row[1],
  language:row[2],
  tld:row[3],
  localSecondhand:row[4],
  index,
}));
