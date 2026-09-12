export function BrandMark({size=32}:{size?:number}) {
 return <img className="brand-mark" src="./brand-mark.svg" width={size} height={size} alt="" aria-hidden="true"/>;
}
export function BrandName() {
 return <b className="brand-name">Game<strong>Atlas</strong></b>;
}
