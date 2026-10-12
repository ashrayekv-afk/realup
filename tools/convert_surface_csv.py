"""Convert an explicitly labelled pointwise CSV into the viewer's JSON contract.

This is NOT a proprietary Pentacam decoder, image digitizer, or summary-index
reconstructor. It never estimates a missing surface or converts unknown units.
Uses Python's standard library only; run locally with deidentified numerical data.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
from pathlib import Path

COLUMNS = {
    'x_mm', 'y_mm', 'z_anterior_mm', 'z_posterior_mm', 'thickness_um',
    'curvature_anterior_D', 'curvature_posterior_D',
    'elevation_anterior_um', 'elevation_posterior_um',
}


def numeric(value: str | None, *, missing: bool = True) -> float | None:
    if value is None or value.strip() in ('', 'null'):
        if missing:
            return None
        raise ValueError('x/y coordinates may not be missing.')
    try:
        result = float(value)
    except ValueError as exc:
        raise ValueError('Only numerical values, empty cells, or literal null are accepted.') from exc
    if not math.isfinite(result):
        raise ValueError('Nonfinite value; use an empty cell or null for a genuinely missing sample.')
    return result


def complete_cell(grid: list[list[float | None]]) -> bool:
    return any(all(grid[y+dy][x+dx] is not None for dx,dy in ((0,0),(1,0),(0,1),(1,1)))
               for y in range(len(grid)-1) for x in range(len(grid[0])-1))


def convert(source: Path, *, eye: str, visit: str, kind: str, coordinate_system: dict,
            curvature_types: dict | None = None, elevation_references: dict | None = None) -> dict:
    if source.stat().st_size > 12*1024*1024:
        raise ValueError('Input exceeds 12 MB.')
    if eye not in ('OD','OS') or visit not in ('first','latest') or kind not in ('measured','synthetic'):
        raise ValueError('Declare a valid eye, visit and measured/synthetic kind.')
    allowed_coordinates = {'origin':('corneal_vertex',), 'x_positive':('temporal','nasal'),
                           'y_positive':('superior','inferior'), 'z_positive':('anterior','posterior')}
    if any(coordinate_system.get(k) not in v for k,v in allowed_coordinates.items()):
        raise ValueError('Explicit, supported coordinate conventions are required.')
    with source.open(newline='',encoding='utf-8-sig') as handle:
        reader=csv.DictReader(handle)
        headers=reader.fieldnames or []
        if len(headers)!=len(set(headers)) or set(headers)-COLUMNS:
            raise ValueError('Duplicate or unsupported columns. Remove identifiers and use the exact documented headers.')
        if not {'x_mm','y_mm'}.issubset(headers) or not {'z_anterior_mm','z_posterior_mm'}.intersection(headers):
            raise ValueError('Need x_mm, y_mm and at least one actual z surface column. Summary values are insufficient.')
        records={}
        for row in reader:
            if None in row: raise ValueError('Malformed CSV row: too many fields.')
            x,y=numeric(row.get('x_mm'),missing=False),numeric(row.get('y_mm'),missing=False)
            if abs(x)>12 or abs(y)>12: raise ValueError('Coordinates exceed ±12 mm. Check units.')
            if (x,y) in records: raise ValueError('Duplicate coordinate pair; reconcile repeats rather than silently selecting one.')
            records[(x,y)]={key:numeric(row.get(key)) for key in headers if key not in ('x_mm','y_mm')}
            if len(records)>40401: raise ValueError('Too many samples for this viewer.')
    xs=sorted({p[0] for p in records});ys=sorted({p[1] for p in records})
    if not (3<=len(xs)<=201 and 3<=len(ys)<=201):
        raise ValueError('Require a rectilinear grid with 3–201 x and y coordinates; scattered points are not resampled.')
    def grid(key,lo,hi):
        result=[[records.get((x,y),{}).get(key) for x in xs] for y in ys]
        for line in result:
            if any(v is not None and not lo<=v<=hi for v in line):
                raise ValueError(f'{key} outside the schema range; verify units.')
        return result
    out={'schema':'nkpi-corneal-surface-1','kind':kind,
         'source':'device_numeric_export' if kind=='measured' else 'synthetic_fixture',
         'eye':eye,'visit':visit,'units':{'xy':'mm','z':'mm','elevation':'um','thickness':'um','curvature':'D'},
         'coordinate_system':{k:coordinate_system[k] for k in allowed_coordinates},'x_mm':xs,'y_mm':ys}
    curvature_types=curvature_types or {};elevation_references=elevation_references or {}
    for layer in ('anterior','posterior'):
        key=f'z_{layer}_mm'
        if key not in headers: continue
        z=grid(key,-30,30)
        if not complete_cell(z): raise ValueError(f'{layer}: no fully supported surface cell.')
        surface={'z_mm':z}
        key=f'curvature_{layer}_D'
        if key in headers:
            g=grid(key,-1000,1000)
            if any(v is not None for line in g for v in line):
                ctype=curvature_types.get(layer)
                if ctype not in ('axial','tangential','mean','device_reported'):
                    raise ValueError(f'Declare the {layer} curvature type.')
                surface.update(curvature_D=g,curvature_type=ctype)
        key=f'elevation_{layer}_um'
        if key in headers:
            g=grid(key,-3000,3000)
            if any(v is not None for line in g for v in line):
                ref=elevation_references.get(layer,{})
                if ref.get('type') not in ('best_fit_sphere','best_fit_ellipsoid','device_reference') or not isinstance(ref.get('fit_diameter_mm'),(int,float)) or not 0<ref['fit_diameter_mm']<=24:
                    raise ValueError(f'Declare the {layer} elevation reference type and fitting diameter.')
                surface.update(elevation_um=g,elevation_reference=ref)
        out[layer]=surface
    if 'thickness_um' in headers:
        g=grid('thickness_um',1,2000)
        if any(v is not None for line in g for v in line):out.update(thickness_um=g,thickness_definition='device_pachymetry')
    return out


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_csv',type=Path);parser.add_argument('output_json',type=Path)
    parser.add_argument('--eye',choices=['OD','OS'],required=True)
    parser.add_argument('--visit',choices=['first','latest'],required=True)
    parser.add_argument('--kind',choices=['measured','synthetic'],required=True)
    parser.add_argument('--origin',choices=['corneal_vertex'],required=True)
    parser.add_argument('--x-positive',choices=['temporal','nasal'],required=True)
    parser.add_argument('--y-positive',choices=['superior','inferior'],required=True)
    parser.add_argument('--z-positive',choices=['anterior','posterior'],required=True)
    parser.add_argument('--confirm-coordinate-frame',action='store_true',help='Confirm that all z surfaces use the same known coordinate frame, not separate apex zeroes.')
    parser.add_argument('--comparison-registration-id',help='Non-identifying key for an externally verified common registered grid.')
    parser.add_argument('--comparison-map-definition-id',help='Non-identifying key for the same device map definition and processing.')
    parser.add_argument('--confirm-visit-registration',action='store_true',help='Confirm registration was established externally; this converter does not align visits.')
    for layer in ('anterior','posterior'):
        parser.add_argument(f'--{layer}-reference-id',help='Key identifying an actual common fixed elevation reference, not merely a reference type.')
        parser.add_argument(f'--{layer}-curvature-type',choices=['axial','tangential','mean','device_reported'])
        parser.add_argument(f'--{layer}-reference-type',choices=['best_fit_sphere','best_fit_ellipsoid','device_reference'])
        parser.add_argument(f'--{layer}-fit-diameter-mm',type=float)
    args=parser.parse_args()
    if not args.confirm_coordinate_frame:parser.error('Explicit --confirm-coordinate-frame is required. Do not guess surface origins.')
    if args.output_json.exists():parser.error('Output already exists. Choose a new file to avoid replacing source data.')
    try:
        out=convert(args.input_csv,eye=args.eye,visit=args.visit,kind=args.kind,
                    coordinate_system={'origin':args.origin,'x_positive':args.x_positive,'y_positive':args.y_positive,'z_positive':args.z_positive},
                    curvature_types={s:getattr(args,s+'_curvature_type') for s in ('anterior','posterior')},
                    elevation_references={s:{'type':getattr(args,s+'_reference_type'),'fit_diameter_mm':getattr(args,s+'_fit_diameter_mm')} for s in ('anterior','posterior')})
        import re
        metadata=[args.comparison_registration_id,args.comparison_map_definition_id]
        if any(metadata) or args.confirm_visit_registration:
            if not args.confirm_visit_registration or not all(isinstance(k,str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',k) for k in metadata):
                raise ValueError('Comparison needs both non-identifying keys and --confirm-visit-registration. This tool does not register maps.')
            out['comparison']={'alignment':'verified_common_grid','registration_id':metadata[0],'map_definition_id':metadata[1]}
        for layer in ('anterior','posterior'):
            key=getattr(args,layer+'_reference_id')
            if key is not None:
                if not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',key) or 'elevation_reference' not in out.get(layer,{}):
                    raise ValueError('A reference key needs a supplied elevation map and supported non-identifying key.')
                out[layer]['elevation_reference']['reference_id']=key
        args.output_json.write_text(json.dumps(out,separators=(',',':'),allow_nan=False),encoding='utf-8')
    except (ValueError,OSError) as exc:parser.exit(1,f'Conversion stopped: {exc}\n')
    print('Created numerical surface JSON. Review the coordinates and sample values before use; the viewer requires case/eye/visit matching.')

if __name__=='__main__':main()
