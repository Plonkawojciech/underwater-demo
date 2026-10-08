"""Attach verified media in source order, independently of download ordering."""

def attach_media(bundle, rows):
    available = {descriptor['key'] for descriptor in bundle['media']}
    entities = {(entity['collection'], entity['key']): entity for entity in bundle['entities']}
    assignments = {}
    for row in rows:
        if row['key'] not in available:
            continue
        for target in row['targets']:
            identity = (target['collection'], target['key'], target['field'])
            if identity[:2] not in entities:
                continue
            order = target.get('order')
            if isinstance(order, bool) or not isinstance(order, int) or order < 0:
                raise ValueError('Media target requires its source position.')
            assignments.setdefault(identity, []).append((order, row['key'], target.get('caption', '')))
    for (collection, key, field), items in assignments.items():
        entity = entities[(collection, key)]
        ordered = []
        seen = set()
        for position, media_key, caption in sorted(items, key=lambda item: item[0]):
            if media_key not in seen:
                seen.add(media_key)
                ordered.append((media_key, caption))
        if field == 'images':
            entity.setdefault('relations', {})['images'] = ['media:' + media_key for media_key, _ in ordered]
        elif field == 'photos':
            entity['data']['photos'] = [{'image': 'media:' + media_key, 'caption': caption} for media_key, caption in ordered]
        elif field == 'body' and collection in {'courses', 'pages', 'trips'} and ordered:
            entity.setdefault('relations', {})['image'] = 'media:' + ordered[0][0]
